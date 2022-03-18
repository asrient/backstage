let colors = ['#502577', '#194570', '#0e3d38', '#134a38', '#344a13', '#4b420f',];
let colorInd = 0;
let changeColors = true;
function changeColor(color = null) {
    if (color) {
        document.body.style.backgroundColor = color;
        return;
    }
    if (!changeColors) return;
    if (colorInd == colors.length) colorInd = 0;
    document.body.style.backgroundColor = colors[colorInd];
    colorInd++;
}

let api = null;
let warningIconURI = '';

async function preloadImage(url) {
    let blob = await fetch(url).then(r => r.blob());
    let dataUrl = await new Promise(resolve => {
        let reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(blob);
    });
    return dataUrl;
}

let lastPing = 0;
let isAccessable = true;
async function ping() {
    if (lastPing + 15 * 1000 <= Date.now()) { //15 secs
        try {
            const res = await api.get('ping');
            console.log('ping', res);
            if (res && res.status == 200) {
                lastPing = Date.now();
                const prevIsAccessable = isAccessable;
                isAccessable = true;
                changeColors = true;
                if (!prevIsAccessable) {
                    changeColor();
                    $('#mb-icon').attr("src", '/media/export-icon.png');
                    $('#mb-text').text('Export to Joplin');
                }
            }
            else {
                // client is logged out
                console.log('ping failed, you are logged out', res);
                window.setTimeout(() => {
                    document.location.href = '/wall.html';
                }, 2000);
            }
        }
        catch (e) {
            if (isAccessable) {
                changeColors = false;
                changeColor('#971414');
                $('#mb-icon').attr("src", warningIconURI);
                $('#mb-text').text('Joplin not reachable');
            }
            isAccessable = false;
            changeColors = false;
        }

    }
}

async function setDeviceInfo() {
    const url = window.location.host;
    const ip = url.split(':')[0];
    const port = url.split(':')[1];
    let connectedOn = Date.now();
    let deviceInfo = {
        deviceName: 'Your Desktop',
        deviceType: 'desktop',
        deviceOS: 'Unknown',
        mac: 'Unknown',
    };
    try {
        const res = await api.get('deviceInfo', { ip });
        console.log('deviceInfo', res);
        if (res.status == 200) {
            if (res.data.deviceInfo)
                deviceInfo = { ...deviceInfo, ...res.data.deviceInfo };
            if (res.data.clientInfo)
                connectedOn = res.data.clientInfo.connectedOn;
            $('#devName').text(deviceInfo.deviceName);
            $('#devIP').text(ip);
            $('#devPort').text(port);
            $('#devOS').text(deviceInfo.deviceOS);
            $('#devMac').text(deviceInfo.mac);
            $('#devPairedOn').text(new Date(connectedOn).toLocaleString());
        }
    }
    catch (e) {
        console.error('could not get device info', e);
    }
}

async function uploadFiles(e) {
    for (let i = 0; i < e.target.files.length; i++) {
        const file = e.target.files[i];
        const filename = file.name;
        const mimeType = file.type;
        const type = 'file';
        const data = { type, filename, mimeType };
        console.log('data', data);
        //var reader = new FileReader();
        const form = new FormData();
        form.append('file', file);
        form.append('data', JSON.stringify(data));
        res = await api._send('POST', 'upload', form, { processData: false, contentType: false });
        console.log('res', res);
    }
}

async function run() {
    $('#imgSelect').on('change', uploadFiles);
    $('#fileSelect').on('change', uploadFiles);
    api = new window.Api('/', { 'X-Client': 'Joplin Backstage v0' });
    window.setInterval(changeColor, 10 * 1000);
    window.setInterval(ping, 5 * 1000);
    changeColor();
    warningIconURI = await preloadImage('/media/warning-icon.png');
    ping();
    setDeviceInfo();
}

run();