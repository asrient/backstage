import joplin from 'api';
import { MenuItemLocation, ToolbarButtonLocation } from 'api/types';
import { randomBytes } from 'crypto';
import { createServer, ClientRequest, ServerResponse, Server as HttpServer, IncomingMessage } from 'http';
import { AddressInfo } from 'net';
import { promisify } from 'util';
import { networkInterfaces, tmpdir, hostname } from 'os';
const formidable = require('formidable');
const fs = joplin.require('fs-extra');
const sqlite3 = joplin.require('sqlite3');
const path = require('path');

const defaultInterfaces = ['eth0', 'wlan0', 'en0', 'en1', 'Wi-Fi',];

class DbManager {
	db = null;
	constructor(filePath: string) {
		this.db = new sqlite3.Database(filePath);
		this.db.getSync = promisify(this.db.get.bind(this.db));
		this.db.runSync = promisify(this.db.run.bind(this.db));
	}
	getConfig = async (key: string) => {
		const sql = `select value from config where key = '${key}'`;
		const result = await this.db.getSync(sql);
		if (!!result) {
			const val = result.value;
			return JSON.parse(val);
		}
		return null;
	}
	setConfig = async (key: string, value: any) => {
		console.log('setting config', key, value);
		const sql = `insert OR replace into config values(?, ?)`;
		const r = await this.db.runSync(sql, key, JSON.stringify(value));
		console.log('set config result', r);
	}
	removeConfig = async (key: string) => {
		const sql = `delete from config where key = ?`;
		await this.db.runSync(sql, key);
	}
	init = async () => {
		await this.db.runSync('CREATE TABLE IF NOT EXISTS config (key TEXT UNIQUE, value TEXT)');
	}
}

function detectClientInfo(userAgent: string) {
	const ua = userAgent;
	let deviceType: string;
	let browser: string;
	let deviceOS: string;
	let deviceName: string;
	// Detect browser
	if (/firefox/i.test(ua))
		browser = 'Firefox';
	else if (/chrome/i.test(ua))
		browser = 'Chrome';
	else if (/safari/i.test(ua))
		browser = 'Safari';
	else if (/msie/i.test(ua))
		browser = 'Internet Explorer';
	else
		browser = 'unknown';
	// Detect OS
	if (/mobile/i.test(ua))
		deviceType = 'phone';
	else deviceType = 'desktop';
	if (/android/i.test(ua))
		deviceOS = 'Android';
	else if (/iphone|ipad|ipod/i.test(ua))
		deviceOS = 'iOS';
	else if (/windows phone/i.test(ua))
		deviceOS = 'Windows Phone';
	else if (/windows/i.test(ua))
		deviceOS = 'Windows';
	else if (/mac/i.test(ua))
		deviceOS = 'macOS';
	else if (/linux/i.test(ua))
		deviceOS = 'Linux';
	else
		deviceOS = 'unknown';
	if (deviceOS === 'Android') {
		deviceName = 'Android Phone';
	}
	else if (deviceOS === 'iOS') {
		deviceName = 'iPhone';
	}
	else if (deviceOS === 'Windows Phone') {
		deviceName = 'Windows Phone';
	}
	else if (deviceOS === 'Windows') {
		deviceName = 'Windows PC';
	}
	else if (deviceOS === 'macOS') {
		deviceName = 'Macbook';
	}
	else if (deviceOS === 'Linux') {
		deviceName = 'Linux PC';
	}
	else {
		deviceName = 'Generic ' + deviceType;
	}
	return { browser, deviceType, deviceOS, deviceName };
}

interface uploadData {
	filePath?: string;
	text?: string;
	size: number;
	filename?: string;
	mimeType: string;
	type: 'text' | 'file';
}

class HttpRequest {
	url: string;
	method: string = 'GET';
	headers: { [key: string]: string | string[] };
	cookies: { [key: string]: string } = {};
	body: string;
	postData: { [key: string]: string };
	getData: { [key: string]: string };
	files: any[] = [];
	_request: IncomingMessage;
	get json() {
		if (this.body.length > 0 && this.headers['content-type'] === 'application/json')
			return JSON.parse(this.body);
		return null;
	}
	constructor(request: IncomingMessage) {
		this._request = request;
		this.url = request.url.split('?')[0];
		this.method = request.method;
		this.headers = request.headers;
		this.cookies = {};
		if (request.headers.cookie) {
			request.headers.cookie.split(';').forEach(cookie => {
				const [key, value] = cookie.split('&')[0].split('=');
				this.cookies[key.trim()] = value;
			});
		}
		this.body = '';
		this.postData = {};
		this.getData = {};
		const getData = request.url.split('?')[1];
		if (getData) {
			const getDataArray = getData.split('&');
			getDataArray.forEach((data) => {
				const [key, value] = data.split('=');
				this.getData[key] = value;
			});
		}
	}
	get mayContainFiles() {
		return this.method === 'POST' && this.headers['content-type']?.includes('multipart/form-data');
	}
	load = async () => {
		const request = this._request;
		return new Promise((resolve, reject) => {
			if (this.mayContainFiles) {
				const form = formidable({
					multiples: true,
					uploadDir: tmpdir(),
					baseDir: global.__dirname,
					keepExtensions: true,
				});
				form.parse(request, function (err, fields: any, files: any) {
					if (err) {
						console.error(err.message);
						reject(err);
					}
					console.log('got upload', fields, files);
					resolve(this);
				});
				form.on('file', (formname, file) => {
					console.log('got file', formname, file);
					this.files.push(file);
				});
				form.on('field', (key, value) => {
					console.log('got field', key, value);
					this.postData[key] = value;
				});
			}
			else {
				request.on('data', (chunk) => {
					this.body += chunk;
				});
				request.on('end', () => {
					if (this.method === 'POST' && this.headers['content-type'] === 'application/x-www-form-urlencoded') {
						const postData = this.body.split('&');
						postData.forEach((data) => {
							const [key, value] = data.split('=');
							this.postData[key] = value;
						});
					}
					resolve(this);
				});
				request.on('error', (err) => {
					reject(err);
				});
			}
		});
	}
}

class HttpResponse {
	statusCode: number = 200;
	headers: { [key: string]: string | string[] };
	cookies: { [key: string]: string } = {};
	body: string;
	isHandeled = false;
	isSent: boolean = false;
	_resp: ServerResponse;
	constructor(resp: ServerResponse) {
		this._resp = resp;
		this.headers = {};
	}
	setHeader = (key: string, value: string | string[]) => {
		this.headers[key] = value;
	}
	setCookie = (key: string, value: string) => {
		this.cookies[key] = value;
	}
	write = (data: any) => {
		this._resp.write(data);
	}
	sendHead = (status: number, headers?: any) => {
		this.isHandeled = true;
		if (this.isSent) {
			return false;
		}
		if (status) this.statusCode = status;
		if (headers) this.headers = { ...this.headers, ...headers };
		if (Object.keys(this.cookies).length > 0)
			this.headers['Set-Cookie'] = Object.keys(this.cookies).map((key) => {
				return `${key}=${this.cookies[key]}`;
			}).join('; ');
		this._resp.writeHead(this.statusCode, this.headers);
		return true;
	}
	send = async (status: number, headers?: any, data?: any) => {
		return new Promise((resolve: any, reject) => {
			if (!this.sendHead(status, headers)) {
				console.log(status, headers, data);
				reject('Response already sent');
			}
			this._resp.end(data, () => {
				this.isSent = true;
				resolve();
			});
			this._resp.on('error', (e: any) => {
				console.error('error sending response', e);
				reject(e);
			});
		});
	}
	apiRespond = async (status: number, data: object) => {
		return await this.send(status, {
			'Content-Type': 'application/json',
			'X-Server': 'Joplin Backstage',
		}, JSON.stringify(data));
	}
}

class BaseServer {
	port = 0;
	active = false;
	server: HttpServer = null;
	publicDir = __dirname;
	// Override
	onError = (err) => {
		console.error(err);
	}
	onServerStart = () => { }
	onServerStop = () => { }
	async onRequest(req: HttpRequest, res: HttpResponse) { }
	constructor(port: number, publicDir?: string) {
		this.port = port;
		if (publicDir) this.publicDir = publicDir;
		this.server = createServer(this._requestHandler);
		this.server.on('error', (e) => { this.active = false; this.onError(e) });
		this.server.on('listening', () => { this.active = true; this.onServerStart() });
		this.server.on('close', () => { this.active = false; this.onServerStop() });
	}
	getIpAddrs() {
		var network = networkInterfaces();
		var obj = {}
		Object.keys(network).forEach((connName) => {
			network[connName].forEach((conn) => {
				if (conn.family === 'IPv4' && conn.address !== '127.0.0.1' && !conn.internal) {
					obj[connName] = conn.address;
				}
			})
		})
		return obj;
	}
	_sendFile = (res: HttpResponse, path: string, mimeType?: string) => {
		fs.access(path, fs.F_OK, (err) => {
			if (err) {
				console.error('could not read file', path, err);
				res.send(404, {}, "404 - File Not Found");
			}
			else {
				const stat = fs.statSync(path);
				res.sendHead(200, { "Content-Type": mimeType || "text/html", 'Content-Length': stat.size });
				const readStream = fs.createReadStream(path);
				readStream.pipe(res._resp);
			}
		});
	}
	_serveFolder = (res: HttpResponse, filePath: string, defaultFile?: string) => {
		if (filePath == '/') filePath = defaultFile || '/index.html';
		filePath = path.join(this.publicDir, filePath);
		var extname = path.extname(filePath);
		var contentType = 'text/html';
		switch (extname) {
			case '.js':
				contentType = 'text/javascript';
				break;
			case '.css':
				contentType = 'text/css';
				break;
			case '.json':
				contentType = 'application/json';
				break;
			case '.png':
				contentType = 'image/png';
				break;
			case '.jpg':
				contentType = 'image/jpg';
				break;
			case '.wav':
				contentType = 'audio/wav';
				break;
		}
		this._sendFile(res, filePath, contentType);
	}
	_requestHandler = async (req: IncomingMessage, res: ServerResponse) => {
		try {
			const request = new HttpRequest(req);
			const response = new HttpResponse(res);
			console.info('request', request.url);
			await request.load();
			await this.onRequest(request, response);
			if (response.isSent || response.isHandeled) return;
			console.info('about to serve public folder', this.publicDir);
			this._serveFolder(response, request.url, 'index.html');
		}
		catch (e) {
			console.error('Server error', e);
			res.writeHead(500, { 'Content-Type': 'text/html' });
			res.end('Internal Server Error\n' + e.toString());
		}
	}
	async start() {
		console.info('Starting Base server...');
		await promisify(this.server.listen.bind(this.server))(this.port, '0.0.0.0');
		const addr = this.server.address() as AddressInfo;
		this.port = addr.port;
		this.active = true;
		console.info(`Base Server listening on port ${this.port}`);
	}
	async stop() {
		if (this.active) {
			this.active = false;
			await promisify(this.server.close.bind(this.server))();
		}
		else {
			console.info('Base server already stopped');
			throw new Error("Base server already stopped");

		}
	}
}

class BS_Server extends BaseServer {
	clientConnected = false;
	clientDeviceInfo = null;
	info = null;
	lastPing = 0;
	otp = null;
	authKey = null;
	otpNextRefresh = 0;
	db: DbManager = null;
	_timeoutId = null;
	// Override
	onUpload = (data: uploadData) => { }
	onClientConnected = (clientInfo: any) => { }
	onClientDisconnected = (clientInfo: any) => { }
	onOtpRefresh = (otp: string) => { }
	constructor(info: any, db: DbManager) {
		super(info.port, path.join(info.installDir, 'client'));
		this.info = info;
		this.db = db;
	}
	verifyAuth = (req: HttpRequest) => {
		if (!this.clientConnected && this.otp) {
			console.log('verifying otp', req.getData, this.otp);
			if (req.getData['otp'] == this.otp) {
				console.info('Otp verified', this.otp);
				this.otp = null;
				this.otpNextRefresh = 0;
				this.authKey = randomBytes(10).toString('hex');
				this.clientConnected = true;
				this.lastPing = Date.now();
				// gather client info
				let address = req._request.socket.remoteAddress;
				this.clientDeviceInfo = {
					deviceId: randomBytes(3).toString('hex'),
					deviceName: 'Generic Phone',
					deviceType: 'phone',
					deviceOS: null,
					browser: null,
					ip: address,
					connectedOn: Date.now(),
				}
				if (req.headers['user-agent']) {
					const ua = req.headers['user-agent'] as string;
					const res = detectClientInfo(ua);
					this.clientDeviceInfo = { ...this.clientDeviceInfo, ...res };
				}
				this.db.setConfig('clientInfo', this.clientDeviceInfo);
				this.db.setConfig('authKey', this.authKey);
				this.db.setConfig('lastPing', this.lastPing);
				this.onClientConnected(this.clientDeviceInfo);
				return true;
			}
			console.warn('Otp invalid', this.otp, req.getData['otp']);
		}
		else if (this.authKey) {
			return this.isAuthValid(req);
		}
		return false;
	}
	isAuthValid = (req: HttpRequest) => {
		if (this.clientConnected && this.authKey && req.cookies['bs-key'] == this.authKey) return true;
		return false;
	}
	refresh = () => {
		if (!this.active) {
			console.log('Backstage server not active, reseting state');
			this.otp = null;
			this.otpNextRefresh = 0;
			if (this._timeoutId) clearTimeout(this._timeoutId);
			return;
		}
		if (!this.clientConnected) {
			if (Date.now() >= this.otpNextRefresh) {
				this.resetOtp();
			}
		}
		else {
			if (Date.now() >= this.lastPing + (this.info.clientExpireAfter || 1000 * 60 * 3)) {
				console.info('Client is inactive for a long time, removing client');
				this.removeClient();
			}
		}
		if (this._timeoutId) clearTimeout(this._timeoutId);
		let nextRefresh = 30 * 1000; // we will regenerate otp
		if (this.clientConnected)
			nextRefresh = 5 * 60 * 1000; // 5 mins, we will check for client expiry
		this._timeoutId = setTimeout(this.refresh, nextRefresh);
	}
	onRequest = async (req: HttpRequest, res: HttpResponse) => {
		if (req.url == '/') {
			res.isHandeled = true;
			if (!this.verifyAuth(req)) {
				this._serveFolder(res, '/wall.html');
				return;
			}
			res.setCookie('bs-key', this.authKey);
			res.setCookie('Max-Age', '7775999'); // 3 months
			this._serveFolder(res, '/index.html');
			return;
		}
		// Authenticated API points
		if (!this.isAuthValid(req)) return;
		switch (req.url) {
			case '/ping':
				this.lastPing = Date.now();
				res.apiRespond(200, { message: 'pong' });
				this.db.setConfig('lastPing', this.lastPing);
				break;
			case '/deviceInfo':
				const deviceInfo = { ...this.info.deviceInfo };
				if (req.getData.ip) {
					deviceInfo.mac = getMacFromIp(req.getData.ip);
				}
				res.apiRespond(200, { clientInfo: this.clientDeviceInfo, deviceInfo });
				break;
			case '/upload':
				if (req.method == 'POST') {
					console.log('got upload req', req, req.files, req.mayContainFiles, req.postData);
					const file = req.files.length ? req.files[0] : null;
					let info: any = {};
					if (req.postData['data']) {
						info = JSON.parse(req.postData['data']);
					}
					const data: uploadData = {
						filename: info.filename ? info.filename : (file ? file.originalFilename : null),
						size: file ? file.size : (info.text ? info.text.length : 0),
						mimeType: file ? file.mimetype : (info.mimeType ? info.mimeType : ''),
						text: info.text ? info.text : null,
						type: (info.type ? info.type : "file") as uploadData["type"],
						filePath: file ? file.filepath : null,
					};
					console.info('upload', data);
					this.onUpload(data);
					res.apiRespond(200, { message: 'uploaded' });
				}
				else {
					res.apiRespond(405, { message: 'Method not allowed' });
				}
				break;
			case '/logout':
				if (req.method == 'POST') {
					this.removeClient();
					this.refresh();
					res.apiRespond(200, { message: 'logged out' });
				}
				else {
					res.apiRespond(405, { message: 'Method not allowed' });
				}
		}
	}
	otpLinks = () => {
		if (!this.otp || !this.active) {
			return null;
		}
		const obj = {
			nextRefresh: this.otpNextRefresh,
			otp: this.otp,
			port: this.port,
			links: []
		}
		const ips = this.getIpAddrs();
		for (let en in ips) {
			obj.links.push({
				name: en,
				ip: ips[en],
				url: `http://${ips[en]}:${this.port}/?otp=${this.otp}`,
				isDefault: defaultInterfaces.includes(en),
			});
		}
		return obj;
	}
	resetOtp = () => {
		if (this.clientConnected) {
			throw new Error('Cannot reset otp while client is connected');
		}
		this.otpNextRefresh = Date.now() + 30 * 1000;
		this.otp = randomBytes(4).toString('hex');
		console.info('Refreshing otp', this.otp);
		console.info(this.otpLinks());
		this.onOtpRefresh(this.otp);
	}
	removeClient = () => {
		const _clientInfo = this.clientDeviceInfo;
		this.clientConnected = false;
		this.authKey = null;
		this.clientDeviceInfo = null;
		this.lastPing = 0;
		this.otpNextRefresh = 0;
		this.db.removeConfig('clientInfo');
		this.db.removeConfig('lastPing');
		this.db.removeConfig('authKey');
		if (_clientInfo)
			this.onClientDisconnected(_clientInfo);
		this.refresh();
	}
	start = async () => {
		console.info('Starting Base server...');
		await super.start.bind(this)();
		this.refresh();
	}
	resetPort = async (port) => {
		this.port = port;
		if (this.active)
			await this.stop();
		await this.start();
	}
	stop = async () => {
		if (this.active) {
			await super.stop.bind(this)();
			this.refresh();
		}
		else {
			console.error('Cannot stop server, stopped already', this);
		}
	}
	loadState = async () => {
		// load previoulsy paired devices from db
		const clientInfo = await this.db.getConfig('clientInfo');
		const authKey = await this.db.getConfig('authKey');
		const lastPing = await this.db.getConfig('lastPing');
		if (!!clientInfo && !!authKey && !!lastPing) {
			console.log('retrived client info', clientInfo, authKey, lastPing);
			this.clientDeviceInfo = clientInfo;
			this.authKey = authKey;
			this.lastPing = lastPing;
			this.clientConnected = true;
		}
		else {
			console.log('no client found in db', clientInfo, authKey, lastPing);
		}
	}
}

class Backstage {
	pluginLoaded = false;
	server: BS_Server = null;
	info = null;
	dialogHandle = null;
	isDialogOpen = false;
	isDisabled = false;
	serviceStartedOn = 0;
	currentNote = null;
	db: DbManager = null;
	constructor(info: any) {
		this.info = info;
		this.db = new DbManager(path.join(this.info.dataDir, 'backstage.db'));
		this.server = new BS_Server(this.info, this.db);
		this.server.onUpload = this.onUpload;
		this.server.onError = this.onError;
		this.server.onServerStart = this.onServerStart;
		this.server.onServerStop = this.onServerStop;
		this.server.onClientConnected = this.onClientConnected;
		this.server.onClientDisconnected = this.onClientDisconnected;
		this.server.onOtpRefresh = this.onOtpRefresh;
		this.load();
	}
	sendDialogEvent = (event: string, data: object = {}) => {
		if (this.dialogHandle) {
			joplin.views.panels.postMessage(this.dialogHandle, {
				...data,
				type: event,
			});
		}
	}
	onOtpRefresh = (otp: string) => {
		this.sendDialogEvent('otpRefresh', { otp });
	}
	onUpload = async (data: uploadData) => {
		if (data.type == 'text' && data.text) {
			this.addTextToNote(data.text);
		}
		else if (data.filePath) {
			await this.saveMedia(data.filename, data.filePath);
			// todo: now delete it from temp folder maybe?
		}
		else {
			console.error('invalid upload', data);
		}
	}
	onError = (err) => {
		console.error('Server Error', err);
		this.sendDialogEvent('serverStopped', { error: err.toString() });
	}
	onServerStart = () => {
		this.serviceStartedOn = Date.now();
		console.info('Backstage server active');
		this.sendDialogEvent('serverStarted');
	}
	onServerStop = () => {
		console.info('Backstage server stopped');
		this.serviceStartedOn = 0;
		this.sendDialogEvent('serverStopped');
	}
	startService = async () => {
		console.info('Backstage server about to start..');
		await this.server.start();
	}
	stopService = async () => {
		console.info('Backstage server about to stop..');
		await this.server.stop();
	}
	onClientDisconnected = (clientInfo: any) => {
		console.info('Client disconnected', clientInfo);
		this.sendDialogEvent('clientDisconnected', { clientInfo });
		if (!this.isDialogOpen) {
			this.stopService();
		}
	}
	onClientConnected = (clientInfo: any) => {
		console.info('Client connected', clientInfo);
		this.sendDialogEvent('clientConnected', { clientInfo });
	}
	showDialog = async () => {
		if (!this.server.active && !this.isDisabled) {
			this.startService();
		}
		const dialogs = joplin.views.dialogs;
		this.isDialogOpen = true;
		const result = await dialogs.open(this.dialogHandle);
		this.isDialogOpen = false;
		console.info('Dialog result: ' + JSON.stringify(result));
		// Dialog closed, stop server if no client is connected
		if (this.server.active && !this.server.clientConnected) {
			this.stopService();
		}
	}
	loadViews = async () => {
		await joplin.commands.register({
			name: 'openBackstage',
			label: 'Open Backstage',
			iconName: 'fas fa-music',
			execute: async () => {
				console.log('Showing backstage');
				await this.showDialog();
			},
		});
		// Add the first command to the note toolbar
		await joplin.views.toolbarButtons.create('BackstageButton', 'openBackstage', ToolbarButtonLocation.NoteToolbar);
		// Setup backstage main dialog
		const dialogs = joplin.views.dialogs;
		const handle = await dialogs.create('mainScreen');
		const html = await promisify(fs.readFile)(path.join(this.info.installDir, 'screen/screen.html'), 'utf8');
		await dialogs.setHtml(handle, html);
		await dialogs.addScript(handle, 'screen/qrcode.min.js');
		await dialogs.addScript(handle, 'screen/screen.js');
		await dialogs.addScript(handle, 'client/xui.css');
		await dialogs.addScript(handle, 'screen/screen.css');
		await dialogs.setFitToContent(handle, true);
		await dialogs.setButtons(handle, [
			{
				id: 'close',
				title: 'Close',
			},
		]);
		this.dialogHandle = handle;
		joplin.views.panels.onMessage(handle, async (msg) => {
			console.info('Got message: ' + JSON.stringify(msg));
			if (msg.type === 'get-state') {
				const state = {
					active: this.server.active,
					clientConnected: this.server.clientConnected,
					clientInfo: this.server.clientDeviceInfo,
					links: this.server.otpLinks(),
				};
				return state;
			}
			else if (msg.type === 'get-links') {
				return this.server.otpLinks();
			}
			else if (msg.type === 'get-clientInfo') {
				return this.server.clientDeviceInfo;
			}
			else if (msg.type === 'removeClient') {
				this.server.removeClient();
			}
			else if (msg.type === 'stopServer') {
				this.isDisabled = true;
				await this.stopService();
				return true;
			}
			else if (msg.type === 'startServer') {
				this.isDisabled = false;
				await this.startService();
				return true;
			}
			else {
				console.error('Unhandled dialog message:', msg);
			}
		});
	}
	addTextToNote = async (text: string) => {
		const note = await joplin.workspace.selectedNote();
		if (!!note) {
			// Set the note body
			if (note.body == null) note.body = '';
			note.body += text;
			const updated = await joplin.data.put(['notes', note.id], null, { body: note.body });
			console.log('note updated', updated);
			// Hack: force a refresh of the note since note does not rerender on update automatically, 
			// https://github.com/laurent22/joplin/issues/5955
			await joplin.commands.execute("editor.setText", note.body);
		}
	}
	saveMedia = async (title: string, filePath: string) => {
		console.log('saving media', title, filePath);
		const res = await joplin.data.post(
			["resources"],
			null,
			{ title }, // Resource metadata
			[
				{
					path: filePath, // Actual file
				},
			]
		);
		console.log('media saved', res);
		let link = `[${title} - using Backsatage](:/${res.id})`;
		if (res.mime.startsWith('image/')) {
			link = '!' + link;
		}
		await this.addTextToNote(`\n${link}\n`);
	}
	getCurrentNote = async () => {
		const note = await joplin.workspace.selectedNote();
		console.log('retrived note', note);
		if (!!note) {
			this.currentNote = {
				id: note.id,
				title: note.title,
			};
		}
	}
	load = async () => {
		joplin.plugins.register({
			onStart: async () => {
				console.info('Backstage plugin loaded');
				this.pluginLoaded = true;
				await this.db.init();
				joplin.workspace.onNoteSelectionChange(async (event: any) => {
					console.log('note selection changed', event);
					this.getCurrentNote();
				});
				await this.server.loadState();
				if (this.server.clientConnected) {
					console.log('starting server since we have a client');
					this.startService();
				}
				await this.loadViews();
			},
		});
	}
}

function getMacFromIp(ip: string) {
	const network = networkInterfaces();
	let mac = null;
	Object.keys(network).find((connName) => {
		return !!(network[connName].find((conn) => {
			if (conn.address == ip && !conn.internal) {
				mac = conn.mac;
				return true;
			}
			return false;
		}))
	})
	return mac;
}

function getDeviceInfo() {
	let OS: string = process.platform;
	switch (process.platform) {
		case 'darwin':
			OS = 'macOS';
			break;
		case 'win32':
			OS = 'Windows';
			break;
		case 'linux':
			OS = 'Linux';
			break;
	}
	let name: string = hostname().split('.')[0];
	return { deviceOS: OS, deviceName: name, deviceType: 'desktop', };
}

async function run() {
	const info = {
		deviceInfo: getDeviceInfo(),
		installDir: '',
		dataDir: '',
		clientExpireAfter: 3 * 60 * 1000, // should ideally be big like 15 days
		port: 2000,
	};
	info.installDir = await joplin.plugins.installationDir();
	info.dataDir = await joplin.plugins.dataDir();
	global.__dirname = info.installDir;
	const backstage = new Backstage(info);
}

run();