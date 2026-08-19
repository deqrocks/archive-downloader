let linksCnt = 0;
let currentPage;
let currentUrl;
let currentParams;
let currentCollectionId;
let isDetailsPage = false;
let tabId;
const baseUri = document.location.origin;
const maxPage = 10;

function getLinks(doc) {
	const currentCollectionId = getArchiveIdentifierFromUrl(document.location.href);
	const domAnchors = doc.querySelectorAll('a[href*="/details/"]');
	const seen = new Set();
	let links = [];

	Array.from(domAnchors).forEach(a => {
		const href = a.href;
		if (!href || seen.has(href)) {
			return;
		}

		const linkId = getArchiveIdentifierFromUrl(href);
		if (!linkId || linkId === currentCollectionId) {
			return;
		}

		const titleNode = a.querySelector('.ttl');
		const title = (titleNode ? titleNode.innerText : a.innerText || '').trim();
		if (!title) {
			return;
		}

		seen.add(href);
		links.push({
			url: href,
			title: title
		});
	});

	return links;
}

function dedupeLinks(links) {
	const seen = new Set();
	return links.filter(link => {
		if (!link || !link.url || seen.has(link.url)) {
			return false;
		}
		seen.add(link.url);
		return true;
	});
}

function getCollectionLinksFromApi(page) {
	const query = new URLSearchParams();
	query.set('q', `collection:${currentCollectionId}`);
	query.append('fl[]', 'identifier');
	query.append('fl[]', 'title');
	query.set('rows', '50');
	query.set('page', String(page));
	query.set('output', 'json');

	return fetchJson(`https://archive.org/advancedsearch.php?${query.toString()}`)
		.then(data => {
			const docs = data && data.response && Array.isArray(data.response.docs) ? data.response.docs : [];
			return dedupeLinks(docs.map(doc => ({
				url: `https://archive.org/details/${doc.identifier}`,
				title: (doc.title || doc.identifier || '').trim()
			})).filter(link => link.url && link.title));
		})
		.catch(err => {
			console.error('collection api failed', err);
			return [];
		});
}

function loadPages() {
	currentUrl = window.location.origin + window.location.pathname;
	currentParams = getQueryStringObject();
	currentPage = ~~currentParams.page || 1;
	isDetailsPage = currentUrl.indexOf('/details/') !== -1;
	currentCollectionId = isDetailsPage ? getArchiveIdentifierFromUrl(document.location.href) : '';

	getNextPage();
}

function getQueryStringObject() {
	if (!location.search) {
		return {page:1};
	}
	let search = location.search.substring(1);
	return JSON.parse('{"' + decodeURI(search).replace(/"/g, '\\"').replace(/&/g, '","').replace(/=/g,'":"') + '"}');
}
function getQueryString() {
	return '?'+Object.keys(currentParams).map(k => k+'='+currentParams[k]).join('&');
}

function getNextPage() {
	currentPage++;
	
	if (currentPage > maxPage) {
		
		return;
	}
	if (isDetailsPage && currentCollectionId) {
		getCollectionLinksFromApi(currentPage).then(links => {
			if (links.length > 0) {
				return links;
			}
			currentParams.page = currentPage;
			const pageUrl = currentUrl + getQueryString();
			return fetchHtml(pageUrl, baseUri).then(pageDom => getLinks(pageDom));
		}).then(links => {
			if (links.length == 0) return;

			const data = {
				type: 'NEXT_PAGE',
				tabId: tabId,
				links: links
			};
			sendMsgObject(data);
			
			if (links.length >= 50) {
				getNextPage();
			}
		});
		return;
	}

	currentParams.page = currentPage;
	const pageUrl = currentUrl + getQueryString();
	
	fetchHtml(pageUrl, baseUri).then(pageDom => {
		let links = getLinks(pageDom);
		
		if (links.length == 0) return;

		const data = {
			type: 'NEXT_PAGE',
			tabId: tabId,
			links: links
		};
		sendMsgObject(data);
		
		if (links.length>=50) {
			getNextPage();
		}
	});

}

function sendMsgObject(obj){
	chrome.runtime.sendMessage(obj, function(response) {
		
	});
}

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {

	try {
		switch(message.type) {
			case 'SCAN_PAGE':
				const href = document.location.href;
				tabId = message.tabId;
				isDetailsPage = href.indexOf('/details/') !== -1;
				currentCollectionId = isDetailsPage ? getArchiveIdentifierFromUrl(href) : '';

				Promise.resolve(getLinks(document)).then(links => {
					if (links.length === 0 && isDetailsPage && currentCollectionId) {
						return getCollectionLinksFromApi(1);
					}
					return dedupeLinks(links);
				}).then(links => {
					linksCnt = links.length;
					const data = {
						tabId: tabId,
						baseUri: baseUri,
						pageHref: href,
						type: 'INIT_ARTICLES',
						links: links
					};
					
					sendMsgObject(data);
					sendResponse({pageHref: href});
					loadPages();
				}).catch(err => {
					console.error(err);
					sendResponse({ error: err.message });
				});
				return true;
			break;
		}
	} catch (err) {
		console.error(err);
		sendResponse({ error: err.message });
	}
});
