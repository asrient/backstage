let colors = ['#502577', '#194570', '#0e3d38', '#134a38', '#344a13', '#4b420f',];
let colorInd = 0;
const colorLock = {
    _lock:false, 
    id: null,
    color: null,
    lock(id, color){
        if(this._lock&&this.id!=id) return false;
        this._lock=true;
        this.id = id;
        if(this.color!=color) 
        changeColor(color);
        this.color = color;
        return true;
    },
    unlock(id){
        if(!this._lock||id!=this.id) return false;
        this._lock=false;
        this.id=null;
        this.color=null;
        changeColor();
        return true;
    }
};
function changeColor(color = null) {
    if (color) {
        document.body.style.backgroundColor = color;
        return;
    }
    if (colorLock._lock) return;
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
                colorLock.unlock('ping');
                if (!prevIsAccessable) {
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
                $('#mb-icon').attr("src", warningIconURI);
                $('#mb-text').text('Joplin not reachable');
            }
            colorLock.lock('ping','#971414');
            isAccessable = false;
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
    const files = e.target.files;
    if(files<=0) return;
    $('#uploadScreen').css('display', 'grid');
    $('#us-btn').css('display', 'none');
    $('#us-icon').attr("src", '/media/upload-icon.png');
    let errCount = 0;
    for (let i = 0; i < files.length; i++) {
        $('#us-text').text(`Uploading ${files.length-i} ${(files.length-i)==1? 'file': 'files'} to Joplin`);
        const file = files[i];
        const filename = file.name;
        const mimeType = file.type;
        const type = 'file';
        const data = { type, filename, mimeType };
        console.log('data', data);
        //var reader = new FileReader();
        const form = new FormData();
        form.append('file', file);
        form.append('data', JSON.stringify(data));
        let success = false;
        try{
            res = await api._send('POST', 'upload', form, { processData: false, contentType: false });
            if(res.status == 200) {
                success = true;
            }
        }
        catch(e){
            console.error('error uploading file', e);
            errCount++;
        }
        console.log('res', res);
    }
    $('#imgSelect').val('');
    $('#fileSelect').val('');
    $('#us-btn').css('display', 'block');
    if(errCount>0) {
        $('#us-icon').attr("src", warningIconURI);
        $('#us-text').text(`${errCount} ${errCount==1? 'file': 'files'} failed to upload`);
        colorLock.lock('upload', '#7f6c15');
    }
    else{
        $('#us-icon').attr("src", '/media/done-icon.png');
        $('#us-text').text('All files uploaded');
        colorLock.lock('upload', '#3b7d13');
    }
}

async function run() {
    $('#imgSelect').on('change', uploadFiles);
    $('#fileSelect').on('change', uploadFiles);
    $('#us-btn').on('click', () => {
        $('#uploadScreen').css('display', 'none');
        colorLock.unlock('upload');
    })
    api = new window.Api('/', { 'X-Client': 'Joplin Backstage v0' });
    window.setInterval(changeColor, 10 * 1000);
    window.setInterval(ping, 5 * 1000);
    changeColor();
    warningIconURI = await preloadImage('/media/warning-icon.png');
    ping();
    setDeviceInfo();
}

run();