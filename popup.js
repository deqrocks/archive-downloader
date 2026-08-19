// Copyright (c) 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
const parser = new DOMParser();
let scan = true;
var tabId;
var uncheckedCounter = 0;
let tabState = null;
let renderedResultIndexes = new Set();
let renderedExtensionIndexes = new Set();
/**
 * Get the current URL.
 *
 * @param {function(string)} callback - called when the URL of the current tab
 *   is found.
 */
function getCurrentTab(callback) {
  // Query filter to be passed to chrome.tabs.query - see
  // https://developer.chrome.com/extensions/tabs#method-query
  var queryInfo = {
	active: true,
	currentWindow: true
  };

  chrome.tabs.query(queryInfo, function(tabs) {
	var tab = tabs[0];
	var url = tab.url;
	
	callback({
		url: url,
		id: tab.id
	});
  });
}

let selectedExtensions = [];
let textFile = null;
var makeTextFile = function (text) {
	var data = new Blob([text], {type: 'text/plain'});

	if (textFile !== null) {
		window.URL.revokeObjectURL(textFile);
	}
	textFile = window.URL.createObjectURL(data);
	return textFile;
};

var createDownloadLink = function (txt) {
	downloadLink.href = makeTextFile(txt);
}

async function syncTabState() {
	tabState = await sendBgMessage({ type: 'GET_TAB_STATE', tabId });
	return tabState;
}

function renderMissingExtensions() {
	if (!tabState) {
		return;
	}

	tabState.extensions.forEach((extension, index) => {
		if (!renderedExtensionIndexes.has(index)) {
			addExtension(extension, index);
			renderedExtensionIndexes.add(index);
		}
	});
}

function renderMissingResults() {
	if (!tabState) {
		return;
	}

	tabState.results.forEach((result, index) => {
		if (!renderedResultIndexes.has(index)) {
			renderedResultIndexes.add(index);
			addLinkToList(result, index);
		}
	});
}

/** UI */

function renderStatus(statusText) {
	document.getElementById('status').textContent = statusText;
}

function updateProgress() {
	progress.max = Number(tabState.max);
	progress.value = Number(tabState.loop);
	progress.setAttribute('data-label', `checked ${progress.value} from ${progress.max} links`);
}
function addLinkToList(result, resultsIndex) {
	addLink(result, resultsIndex);
	updateProgress();
	renderMissingExtensions();
	tabState.extensions.forEach((e,i)=>updateExtensionProgress(e,i));
}
function updateExtensionProgress(e, extIndex) {
	var id = 'ext_'+extIndex;
	var counter = extList.querySelector(`#${id} ~ [data-counter]`);
	setExtensionPercent(counter, e);
}
function setExtensionPercent(counter, e) {
	let loop = tabState.loop;
	var percent = parseFloat(e.count * 100 / loop).toFixed(0);
	counter.innerText = `${percent} %`;
	if (percent > 80) {
		counter.className='super';
	} else if (percent > 50) {
		counter.className='fine';
	} else if (percent > 25) {
		counter.className='medium';
	} else {
		counter.className='bad';
	}
}

function updateTxtLink() {
	var txtLinks = _getSelectedLinks().map(c=>c.value).join('\r\n');	
	createDownloadLink(txtLinks);
}
function showLinksDownload(show) {
	if (selectedExtensions.length === 0) {
		show = false
	}
	txtLinksDownload.style.display = show ? 'inline-block': 'none';
}
function listCompleted() {
	showLinksDownload(true);
	info.innerText = "Please select file format.";
	stopScanBtn.style.display = "none";
}

function addInfoAboutPossibleExtensions(linkInput, label) {
	var extIndexes = linkInput.getAttribute('data-ext').split(',');
	label.title = label.title + '\nAllowed formats:\n' + extIndexes.map(ei=>tabState.extensions[ei].name + '('+tabState.extensions[ei].ext+')').join('\n');
}

function onExtensionCheckboxChange(e) {
	const selectedExtensionIndex = e.target.value;
	let indexes = [];

	if (!e.target.checked) {
		let idx = selectedExtensions.indexOf(selectedExtensionIndex);
		selectedExtensions.splice(idx,1);
	} else {
		selectedExtensions.push(selectedExtensionIndex);
	}

	applySelectedExtensionsToList();
}

function applySelectedExtensionsToList() {
	if (selectedExtensions.length === 0) {
		downloadsList.querySelectorAll('input[type="checkbox"]').forEach(i=>{
			setLinkValues(i, false);
		});
		
		showLinksDownload(false);
		return;
	}
	
	showLinksDownload(true);
	
	let matchingText = selectedExtensions.map((sei,i)=>`<span class="matching-chips" title="Matching order: ${i+1}${i>0?`\nTo change matching order, select/deselect file formats in different order`:''}">${tabState.extensions[sei].ending}</span>`).join('');
	info.innerHTML = `Matching types: ${matchingText}`;

	let matchedLinks=[];
	selectedExtensions.forEach((extIndex,i) => {
		matchedLinks = downloadsList.querySelectorAll('input[data-ext*="'+extIndex+'"]');
		matchedLinks.forEach(link => {
			if (link.checked === false) {
				setLinkValues(link, true, extIndex);
			}
		});
	})
	
	if (matchedLinks.length > 0) {
		updateTxtLink();
	}
}
function sendMsgToTab(msg, callback) {
	getCurrentTab(function(tab) {
		chrome.tabs.sendMessage(tab.id, msg, function(response) {
			if (chrome.runtime.lastError) {
				if (typeof callback == 'function') {
					callback(null, chrome.runtime.lastError);
				}
				return;
			}
			if (typeof callback == 'function') {
				callback(response);
			}			
		})
	});
}

function _getSelectedLinks() {
	var checkboxes = downloadsList.querySelectorAll('input[type=checkbox]');
	var txtLinks = Array.from(checkboxes).filter(c=>c.checked);
	return txtLinks;
}
function checkScaner() {
	syncTabState().then(() => {
		if (!tabState) {
			setTimeout(checkScaner, 500);
			return;
		}
		renderMissingResults();
		renderMissingExtensions();
	
		if (tabState.activeProcesCnt <= 0 && tabState.articles.length === 0) {
			listCompleted();
			return;
		}
		setTimeout(checkScaner, 500);
	});
}

async function initViews() {
	await syncTabState();
	if (!tabState) {
		setTimeout(initViews, 100);
		return;
	}
	
	_clearForm();
	renderedResultIndexes = new Set();
	renderedExtensionIndexes = new Set();

	if (tabState.downloadStatus == DOWNLOAD_STATUS.unknown) {
		renderMissingExtensions();
		renderMissingResults();
		setTimeout(checkScaner, 500);
	} else {
		showDownloadView();
	}
}

function onStopScanClick(e) {
	let txt = '';
	if (scan) {
		scan = false;
		sendBgMessage({ type: 'SET_SCAN_DONE', tabId, scanDone: true });
		txt = 'Stopping...';
		e.target.disabled = true;
		setTimeout(function () {
			if (!scan) {
				if (tabState && tabState.loop < tabState.max) {
					e.target.innerText = "Start scan";
					e.target.disabled = false;
				} else {
					e.target.style.display = "none";
				}
			}
		}, 3000);
	} else {
		txt = "Stop scan";
		scan = true;
		sendBgMessage({ type: 'SET_SCAN_DONE', tabId, scanDone: false });
	}
	e.target.innerText = txt;
}

function _clearForm() {
	downloadsList.innerHTML = '';
	extList.innerHTML = '';
	downloadProgress.innerHTML = 'processing...';
	progress.max=0;
	progress.value=0;
	progress.setAttribute('data-label', '');
	downloadCompleted.style.display = "none";
}

async function initPopup(tab) {
	badUrl.style.display="none";
	searchView.style.display="flex";

	tabId = tab.id;
	await syncTabState();
	if (tabState && tabState.results.length > 0) {
		setTimeout(function () {initViews();}, 100);
		return;
	}

	let msgData = {type: 'SCAN_PAGE', tabId: tab.id};
	sendMsgToTab(msgData, function (response) {
		setTimeout(initViews, 100);
		if (!response) {
			chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["helpers.js", "content_script.js"] }, function() {
				sendMsgToTab(msgData, function () {
				});
			});
			return;
		}
	});
}



document.addEventListener('DOMContentLoaded', function() {

	getCurrentTab(function(tab) {
		if (tab.url.indexOf('/details')==-1 && tab.url.indexOf('/search.php')==-1) {
			badUrl.style.display="block";
			aresExampleLink.addEventListener('click', () => {
			chrome.tabs.update(tab.id, {url: aresExampleLink.href }, function () {
					window.close();
				});
			})
			return;
		}
		initPopup(tab);
	});
	
	closeBtn.addEventListener('click', function () {
		window.close();
	});
	
	downloadsList.addEventListener('click', function (e) {
		if (selectedExtensions.length === 0) {
			alert('Please select file format first.');
		}
		if (e.target.type == 'checkbox') {
			if (!e.target.checked) {
				uncheckedCounter++;
				if (uncheckedCounter>=3) {
					uncheckedCounter = 0;
					if (confirm('uncheck all?\nThis popup will appear alwyas when you uncheck 3 links')) {
						downloadsList.querySelectorAll('input[type=checkbox]').forEach(c=>c.checked = false);
					}
				}
			}
		}
	});
	startDownload.addEventListener('click', onStartDownloadClick);
	downloadProgress.addEventListener('click', onProgressClick);
	newSearchBtn.addEventListener('click', onNewSearchClick);
	stopScanBtn.addEventListener('click', onStopScanClick);
});

