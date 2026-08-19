importScripts('globals.js', 'helpers.js');

const MAX_ACTIVE_THREADS = 5;
const MAX_PARALLEL_DOWNLOADS = 5;

var tabs = {};
var dataTemplate = {
	articles: [],
	results: [],
	extensions: [],
	max: 0,
	loop: 0,
	scanDone: false,
	baseUri: '',
	downloadProgressData: [],
	downloadStatus: 0,
	activeProcesCnt: 0,
	pageHref: '',
	activeDownloadCount: 0,
	nextDownloadIndex: 0
};

function _copyObject(obj) {
	return JSON.parse(JSON.stringify(obj));
}

function ensureTab(tabId) {
	if (!tabs[tabId]) {
		tabs[tabId] = _copyObject(dataTemplate);
	}
	return tabs[tabId];
}

function dedupeByKey(items, keyFn) {
	const seen = new Set();
	return items.filter(item => {
		const key = keyFn(item);
		if (!key || seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	});
}

function isArchiveDetailsUrl(url) {
	if (!url) {
		return false;
	}
	try {
		const parsed = new URL(url);
		return parsed.protocol === 'https:' &&
			parsed.hostname === 'archive.org' &&
			(parsed.pathname.indexOf('/details') === 0 || parsed.pathname.indexOf('/search.php') === 0);
	} catch (err) {
		return false;
	}
}

function updateActionForTab(tabId, url) {
	if (!chrome.action || typeof chrome.action.enable !== 'function') {
		return;
	}

	if (isArchiveDetailsUrl(url)) {
		chrome.action.enable(tabId);
	} else {
		chrome.action.disable(tabId);
	}
}

function clearData(tabId) {
	tabs[tabId] = _copyObject(dataTemplate);
}

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
	let data;

	switch (message.type) {
		case 'INIT_ARTICLES':
			tabs[message.tabId] = _copyObject(dataTemplate);
			data = tabs[message.tabId];
			data.baseUri = message.baseUri;
			data.pageHref = message.pageHref || message.baseUri;
			data.articles = dedupeByKey(message.links || [], link => link && link.url);
			data.max = parseInt(data.articles.length);
			data.tabId = message.tabId;

			if (data.articles.length === 0) {
				sendResponse({ error: "can't find any articles here" });
				return;
			}
			if (!data.scanDone) {
				processOneArticle(message.tabId);
			}
			sendResponse({ ok: true });
		break;
		case 'NEXT_PAGE':
			data = ensureTab(message.tabId);
			const nextLinks = dedupeByKey(message.links || [], link => link && link.url);
			const existingArticleUrls = new Set(data.articles.map(link => link.url));
			const filteredLinks = nextLinks.filter(link => !existingArticleUrls.has(link.url));
			data.max += filteredLinks.length;
			data.articles = data.articles.concat(filteredLinks);
			sendResponse({ ok: true });
		break;
		case 'GET_TAB_STATE':
			sendResponse(_copyObject(tabs[message.tabId] || null));
		break;
		case 'SET_SCAN_DONE':
			data = ensureTab(message.tabId);
			data.scanDone = !!message.scanDone;
			if (!data.scanDone) {
				processOneArticle(message.tabId);
			}
			sendResponse({ ok: true });
		break;
		case 'START_DOWNLOAD':
			startDownload(message.tabId, message.data || []);
			sendResponse({ ok: true });
		break;
		case 'RESET_STATUS':
			resetStatus(message.tabId);
			sendResponse({ ok: true });
		break;
	}
});

chrome.tabs.onUpdated.addListener(function(tabId, change) {
	const tabData = tabs[tabId];
	if (change.url) {
		updateActionForTab(tabId, change.url);
	}
	if (!tabData) {
		return;
	}
	if (change.status === 'loading' && change.url && change.url !== tabData.pageHref) {
		delete tabs[tabId];
	}
});

chrome.tabs.onActivated.addListener(function(activeInfo) {
	chrome.tabs.get(activeInfo.tabId, function(tab) {
		if (chrome.runtime.lastError || !tab) {
			return;
		}
		updateActionForTab(tab.id, tab.url);
	});
});

chrome.runtime.onInstalled.addListener(function() {
	chrome.tabs.query({}, function(allTabs) {
		allTabs.forEach(tab => updateActionForTab(tab.id, tab.url));
	});
});

function processOneArticle(tabId) {
	pumpArticles(tabId);
}

function pumpArticles(tabId) {
	const data = tabs[tabId];
	if (!data || data.scanDone) {
		return;
	}

	while (data.activeProcesCnt < MAX_ACTIVE_THREADS && data.articles.length > 0 && !data.scanDone) {
		const article = data.articles.shift();
		if (!article) {
			return;
		}

		data.activeProcesCnt++;
		fetchText(article.url)
			.then(async html => {
				data.loop++;
				let downloadData = await getDownloadUrlsFromHtml(html, article.url, tabId);
				let result = {
					url: article.url,
					title: article.title,
					downloadUrls: downloadData.urls,
					extIndexes: downloadData.indexes,
					rendered: false
				};

				data.results.push(result);
			})
			.catch(function(err) {
				console.error(err);
			})
			.finally(function() {
				data.activeProcesCnt--;
				pumpArticles(tabId);
			});
	}
}

async function getDownloadUrlsFromHtml(html, articleUrl, tabId) {
	const identifier = getArchiveIdentifierFromUrl(articleUrl);
	if (!identifier) {
		return { urls: [], indexes: [] };
	}
	return getDownloadUrlsFromMetadata(identifier, html, tabId);
}

async function getDownloadUrlsFromMetadata(identifier, html, tabId) {
	try {
		const metadataUrl = buildArchiveMetadataUrl(identifier);
		const metadata = await fetchJson(metadataUrl);
		if (!metadata || !Array.isArray(metadata.files)) {
			throw new Error('missing metadata files');
		}

		const downloadUrls = [];
		const extIndexes = [];
		metadata.files.forEach(file => {
			if (!file || !file.name || file.name.endsWith('/')) {
				return;
			}

			const downloadUrl = buildArchiveDownloadUrl(identifier, file.name);
			const fileInfo = {
				name: file.name,
				format: file.format || '',
				downloadUrl
			};
			const extension = updateExtensions(fileInfo, tabId);
			const extIdx = tabs[tabId].extensions.indexOf(extension);
			downloadUrls.push({
				url: downloadUrl,
				extIdx: extIdx,
				size: file.format || file.name
			});
			extIndexes.push(extIdx);
		});

		const uniqueDownloads = dedupeByKey(downloadUrls, item => item.url);
		if (uniqueDownloads.length > 0) {
			return { urls: uniqueDownloads, indexes: uniqueDownloads.map(item => item.extIdx) };
		}
		throw new Error('no downloadable files in metadata');
	} catch (err) {
		console.warn('metadata lookup failed, falling back to html scraping', err);
		return getDownloadUrlsFromHtmlFallback(html, tabId);
	}
}

function getDownloadUrlsFromHtmlFallback(html, tabId) {
	const anchors = extractDownloadAnchorsFromHtml(html, tabs[tabId].baseUri);
	var downloadUrls = [];
	var extIndexes = [];

	anchors.forEach(anchor => {
		var fileInfo = {
			name: anchor.text || anchor.title || anchor.href.split('/').pop(),
			format: anchor.title || '',
			downloadUrl: anchor.href
		};
		var extension = updateExtensions(fileInfo, tabId);
		var extIdx = tabs[tabId].extensions.indexOf(extension);
		downloadUrls.push({ url: anchor.href, extIdx: extIdx, size: anchor.title });
		extIndexes.push(extIdx);
	});

	const uniqueDownloads = dedupeByKey(downloadUrls, item => item.url);
	return { urls: uniqueDownloads, indexes: uniqueDownloads.map(item => item.extIdx) };
}

function updateExtensions(fileInfo, tabId) {
	var extensionType = '.' + (fileInfo.name.split('.').slice(-1));
	var ending = fileInfo.format || getEndingFromHref(fileInfo.downloadUrl);
	var extension = getExtensions(tabId).find(f => f.ending === ending);

	if (extension) {
		extension.count++;
	} else {
		extension = {
			ext: extensionType,
			ending: ending,
			name: fileInfo.format || fileInfo.name,
			count: 1
		};
		tabs[tabId].extensions.push(extension);
	}

	return extension;
}

function startDownload(tabId, initialData) {
	const data = ensureTab(tabId);
	data.downloadProgressData = dedupeByKey(initialData || [], item => item && item.url);
	data.downloadStatus = DOWNLOAD_STATUS.started;
	data.activeDownloadCount = 0;
	data.nextDownloadIndex = 0;
	pumpDownloads(tabId);
}

function pumpDownloads(tabId) {
	const data = tabs[tabId];
	if (!data || data.downloadStatus === DOWNLOAD_STATUS.completed) {
		return;
	}

	while (data.activeDownloadCount < MAX_PARALLEL_DOWNLOADS && data.nextDownloadIndex < data.downloadProgressData.length) {
		const item = data.downloadProgressData[data.nextDownloadIndex];
		data.nextDownloadIndex++;

		if (!item || item.state !== STATE.ready) {
			continue;
		}

		item.state = STATE.in_progress;
		data.activeDownloadCount++;

		chrome.downloads.download({ url: item.url }, function(downloadId) {
			if (chrome.runtime.lastError || typeof downloadId !== 'number') {
				item.state = STATE.interrupted;
				item.errorMsg = chrome.runtime.lastError ? chrome.runtime.lastError.message : 'download failed';
				data.activeDownloadCount = Math.max(0, data.activeDownloadCount - 1);
				refreshStatus(tabId);
				pumpDownloads(tabId);
				return;
			}

			item.id = downloadId;
			refreshStatus(tabId);
		});
	}

	maybeFinalizeDownloads(tabId);
}

chrome.downloads.onChanged.addListener(function(delta) {
	let datas = _getTabDataByDownloadId(delta.id);
	datas.forEach((data) => {
		const item = data.downloadProgressData.find(d => d.id == delta.id);
		if (!item) {
			return;
		}

		if (delta.bytesReceived) {
			item.bytesReceived = delta.bytesReceived.current;
			refreshStatus(data.tabId);
		}
		if (delta.totalBytes) {
			item.totalBytes = delta.totalBytes.current;
			refreshStatus(data.tabId);
		}

		if (delta.state && delta.state.current === 'complete') {
			item.state = STATE.completed;
			item.bytesReceived = item.totalBytes || item.bytesReceived || 100;
			item.totalBytes = item.totalBytes || item.bytesReceived || 100;
			data.activeDownloadCount = Math.max(0, data.activeDownloadCount - 1);
			refreshStatus(data.tabId);
			pumpDownloads(data.tabId);
		} else if (delta.error) {
			if (delta.error.current === 'USER_CANCELED') {
				item.state = STATE.canceled;
			} else {
				item.state = STATE.interrupted;
				item.errorMsg = delta.error.current;
			}
			data.activeDownloadCount = Math.max(0, data.activeDownloadCount - 1);
			refreshStatus(data.tabId);
			pumpDownloads(data.tabId);
		} else if (delta.paused) {
			if (delta.paused.current === true) {
				item.state = STATE.paused;
				item.canResume = delta.canResume.current;
				data.activeDownloadCount = Math.max(0, data.activeDownloadCount - 1);
			} else {
				item.state = STATE.in_progress;
				data.activeDownloadCount++;
			}
			refreshStatus(data.tabId);
		}

		maybeFinalizeDownloads(data.tabId);
	});
});

function maybeFinalizeDownloads(tabId) {
	const data = tabs[tabId];
	if (!data || data.downloadProgressData.length === 0) {
		return;
	}

	const done = data.downloadProgressData.every(item => {
		return item.state === STATE.completed ||
			item.state === STATE.canceled ||
			item.state === STATE.interrupted;
	});

	if (done && data.activeDownloadCount === 0 && data.nextDownloadIndex >= data.downloadProgressData.length) {
		data.downloadStatus = DOWNLOAD_STATUS.completed;
	}
}

function _getTabDataByDownloadId(downloadId) {
	return Object.values(tabs).filter(tab => tab.downloadProgressData.find(dpd => dpd.id == downloadId));
}

function refreshStatus(tabId) {
	tabs[tabId].downloadStatus = DOWNLOAD_STATUS.refresh;
}

function resetStatus(tabId) {
	tabs[tabId].downloadStatus = DOWNLOAD_STATUS.unknown;
}

function getDownloadStatus(tabId) {
	return tabs[tabId] ? tabs[tabId].downloadStatus : DOWNLOAD_STATUS.unknown;
}

function getDownloadProgress(tabId) {
	return tabs[tabId] ? tabs[tabId].downloadProgressData : [];
}

function getExtensions(tabId) {
	return tabs[tabId] ? tabs[tabId].extensions : [];
}

function getResults(tabId) {
	return tabs[tabId] ? tabs[tabId].results : [];
}
