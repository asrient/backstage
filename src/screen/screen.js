console.log("Backstage kicking in..");

let state = {
    loading: true,
    active: false,
    clientConnected: false,
    clientInfo: null,
    links: null,
    _activeTab: 'loading-view'
};

let qr = null;

const $ = document.querySelector.bind(document);

function formatTime(time) {
    const date = new Date(time);
    return date.toTimeString().split(' ')[0];
}

async function send(event, data = {}) {
    return await webviewApi.postMessage({
        ...data,
        type: event,
    });
}

// Button events dispatcher
document.addEventListener('click', async event => {
    const element = event.target;
    if (element.id.startsWith('btn-')) {
        element.disabled = true;
        if (element.id === 'btn-enable') {
            await send('startServer');
        }
        else if (element.id === 'btn-disable') {
            await send('stopServer');
        }
        else if (element.id === 'btn-disable2') {
            await send('stopServer');
        }
        else if (element.id === 'btn-forget') {
            await send('removeClient');
        }
        element.disabled = false;
    }
})

async function actions(newState) {
    if (!newState.active && !newState.loading) {
        newState._activeTab = 'stopped-view';
    }
    else if (newState.active && !newState.clientConnected) {
        newState._activeTab = 'otp-view';
    }
    else if (newState.clientConnected && newState.active) {
        newState._activeTab = 'client-view';
    }
    else {
        newState._activeTab = 'loading-view';
    }
    if (newState._activeTab !== state._activeTab) {
        $('#' + state._activeTab).classList.toggle('active', false);
        $('#' + newState._activeTab).classList.toggle('active', true);
    }
    if (newState.links !== state.links && !!newState.links) {
        let link = newState.links.links.filter(l => l.isDefault)[0];
        if (!link) {
            link = newState.links.links[0];
        }
        if (!!qr) {
            qr.clear();
            qr.makeCode(link.url);
        }
        else {
            qr = new QRCode($("#qr"), {
                text: link.url,
                width: 192,
                height: 192,
            });
        }
        $('#co-url').innerHTML = link.url;
        $('#co-en').innerHTML = link.name;
        $('#co-ip').innerHTML = link.ip;
        $('#co-port').innerHTML = newState.links.port;
        $('#co-otp').innerHTML = newState.links.otp;
    }
    if (newState.clientInfo !== state.clientInfo && !!newState.clientInfo) {
        const info = newState.clientInfo;
        $('#cl-name').innerHTML = info.deviceName || 'Generic Device';
        $('#cl-id').innerHTML = info.deviceId;
        $('#cl-os').innerHTML = info.deviceOS || 'Unknown';
        $('#cl-browser').innerHTML = info.browser || 'Unknown';
        $('#cl-ip').innerHTML = info.ip || 'Unknown';
        $('#cl-time').innerHTML = formatTime(info.connectedOn);
        if (info.deviceType == 'phone') {
            $('#cl-hero').innerHTML = '📱';
            $('#cl-hero').style.fontSize = '13rem';
        }
        else {
            $('#cl-hero').innerHTML = '🖥';
            $('#cl-hero').style.fontSize = '10rem';
        }
    }
}

async function updateState(newState) {
    console.log('updating state', newState);
    actions(newState);
    state = newState;
}

async function run() {
    const _state = await send('get-state');
    console.log('got state', _state);
    updateState({ ...state, ..._state, loading: false });
}

// Events from plugin
webviewApi.onMessage(async (_msg) => {
    console.log('got message', _msg);
    const msg = _msg.message;
    if (msg.type === 'clientConnected') {
        const clientInfo = await send('get-clientInfo');
        updateState({ ...state, clientConnected: true, clientInfo });
    }
    else if (msg.type === 'clientDisconnected') {
        updateState({ ...state, clientConnected: false, clientInfo: null });
    }
    else if (msg.type === 'serverStopped') {
        updateState({ ...state, active: false, links: null });
    }
    else if (msg.type === 'serverStarted') {
        const links = await send('get-links');
        updateState({ ...state, active: true, links });
    }
    else if (msg.type === 'otpRefresh') {
        const links = await send('get-links');
        updateState({ ...state, links });
    }
    else {
        console.error('unhandled message', msg);
    }
});

run();