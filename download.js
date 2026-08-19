var downloadsTabId;
function onStartDownloadClick() {
	let data = _getSelectedLinks().map(l => {
		return {
			id: 0,
			resultIndex: l.getAttribute('data-idx'),
			url: l.value,
			state: STATE.ready,
			totalBytes: 0,
			bytesReceived: 0
		}
	});
	sendBgMessage({ type: 'START_DOWNLOAD', tabId, data });
	showDownloadView();
	if (!downloadsTabId) {
		chrome.tabs.create({url:'chrome://downloads', active: false}, function (tab){
			downloadsTabId = tab.id;
		});
	}
}
function onNewSearchClick() {
	sendBgMessage({ type: 'RESET_STATUS', tabId });
	selectedExtensions = [];
	renderedResultIndexes = new Set();
	renderedExtensionIndexes = new Set();
	_clearForm();
	searchView.style.display = 'flex';
	downloadsView.style.display = 'none';
	stopScanBtn.style.display = 'block';
	downloadProgress.innerHTML = 'processing...';
	downloadCompleted.style.display = "none";
}
function showDownloadView() {
	searchView.style.display = 'none'; //hide view 1 and show view 2 only for downloads
	downloadsView.style.display = 'block';
	paintDownloadView();
}

function onProgressClick(e) {
	if (e.target.dataset) {
		const id = Number(e.target.dataset.id);
		
		switch(e.target.dataset.action) {
			case PROGRES_ACTIONS.pause:
				chrome.downloads.pause(id);
			break;

			case PROGRES_ACTIONS.resume:
				chrome.downloads.resume(id);
			break;

			case PROGRES_ACTIONS.cancel:
				chrome.downloads.cancel(id);
			break;

			case PROGRES_ACTIONS.show:
				chrome.downloads.show(id);
			break;
		}
	}

}
function createProgressItem(progressData) {
	const status = getActions(progressData);

	let temp = `<li>
		<label title="${progressData.url}"><h3>${progressData.url}</h3></label>

		<progress 
			class="download-progress state-${progressData.state}" 
			data-state="${progressData.state}"
			value="${progressData.bytesReceived}" 
			max="${progressData.totalBytes}" 
			data-label="${status.name}"></progress>
		
		<span class="download-actions">
			${status.actions.map(action=>`<button data-action="${action.name}" data-id="${progressData.id}">${action.name}</button>`).join('')}
		</span>
	</li>`;
	let doc = parser.parseFromString(temp, 'text/html');
	let li = doc.querySelector('li');	
	return li;
}

function getActions(progressData) {
	let actions = [];
	let name = '';
	let percent = 0;

	if (progressData.totalBytes > 0) {
		percent = parseFloat(progressData.bytesReceived * 100/progressData.totalBytes).toFixed(0);	
	}

	switch(progressData.state) {
		case STATE.in_progress:
			actions.push({name: PROGRES_ACTIONS.pause});
			actions.push({name: PROGRES_ACTIONS.cancel});
			let received = parseFloat(progressData.bytesReceived/1000000).toFixed(1);
			let total = parseFloat(progressData.totalBytes/1000000).toFixed(1);
			name = `${percent}% ${received}/${total}MB`;
		break;
		case STATE.paused:
			actions.push({name: PROGRES_ACTIONS.resume});
			actions.push({name: PROGRES_ACTIONS.cancel});
			name = `Paused at ${percent}%`;
		break;
		case STATE.canceled:
			name = 'Canceled';
			break;
		case STATE.interrupted:
			name = 'Interrupted';
			break;
		case STATE.completed:
			name = "Completed";
			actions.push({name: PROGRES_ACTIONS.show});
			break;
	}
	return { actions, name }
}

function paintDownloadView() {
	syncTabState().then(() => {
		if (!tabState) {
			setTimeout(paintDownloadView, 1000);
			return;
		}
		let downloadStatus = tabState.downloadStatus;
		if (downloadStatus == DOWNLOAD_STATUS.refresh || downloadStatus == DOWNLOAD_STATUS.completed) {
			downloadProgress.innerHTML='';
			tabState.downloadProgressData.map(dd=>downloadProgress.appendChild(createProgressItem(dd)));
		}
		if (downloadStatus != DOWNLOAD_STATUS.completed) {
			setTimeout(paintDownloadView, 1000);
		} else {
			downloadCompleted.style.display = 'block';
		}
	});
}
