const fetchText = function (url) {
	return fetch(url).then(res => res.text());
}

const fetchJson = function (url) {
	return fetch(url).then(res => res.json());
}

const fetchHtml = function (url, baseUri) {
	return new Promise(function(fulfill, reject) {
		fetch(url)
			.then(res => res.text())
			.then(txt => {
				var doc = makeHtmlFromText(txt);
				var base = document.createElement('base');
				base.href = baseUri;
				doc.head.appendChild(base);
				fulfill(doc);
			})
			.catch(reject);
	});
}

const makeHtmlFromText = function (txt) {
	const parser = new DOMParser();
	const doc = parser.parseFromString(txt, 'text/html');
	return doc;
}

function getEndingFromHref(href) {
	const extEndings = [
		"_daisy.zip",
		"_text.pdf",
		"_abbyy.gz",
		"_archive.torrent",
		"_jp2.zip"
	];

	let ending = "";
	extEndings.find(e => {
		if (href.endsWith(e)) {
			ending = e;
		}
	});

	if (!ending) {
		const pathname = new URL(href, "https://archive.org").pathname;
		const dotIdx = pathname.lastIndexOf(".");
		ending = dotIdx === -1 ? pathname : pathname.slice(dotIdx);
	}

	return ending;
}

function getArchiveIdentifierFromUrl(url) {
	try {
		const parsed = new URL(url);
		const parts = parsed.pathname.split('/').filter(Boolean);
		const detailsIndex = parts.indexOf('details');
		if (detailsIndex !== -1 && parts[detailsIndex + 1]) {
			return parts[detailsIndex + 1];
		}
		if (parts.length > 0) {
			return parts[parts.length - 1];
		}
	} catch (err) {
	}
	return '';
}

function buildArchiveMetadataUrl(identifier) {
	return `https://archive.org/metadata/${encodeURIComponent(identifier)}`;
}

function buildArchiveDownloadUrl(identifier, fileName) {
	const encodedName = fileName.split('/').map(part => encodeURIComponent(part)).join('/');
	return `https://archive.org/download/${encodeURIComponent(identifier)}/${encodedName}`;
}

function extractDownloadAnchorsFromHtml(html, baseUri) {
	const anchors = [];
	const regex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
	let match;

	while ((match = regex.exec(html)) !== null) {
		const attrs = {};
		const attrText = match[1] || '';
		const attrRegex = /([a-zA-Z0-9:-]+)\s*=\s*["']([^"']*)["']/g;
		let attrMatch;

		while ((attrMatch = attrRegex.exec(attrText)) !== null) {
			attrs[attrMatch[1].toLowerCase()] = attrMatch[2];
		}

		const className = attrs.class || '';
		if (!className.includes('format-summary') || !className.includes('download-pill')) {
			continue;
		}

		if (!attrs.href) {
			continue;
		}

		const href = new URL(attrs.href, baseUri).href;
		if (href.indexOf('/stream/') !== -1) {
			continue;
		}

		anchors.push({
			href,
			title: attrs.title || "",
			text: (match[2] || '').replace(/[\n\t]/g, "").replace("download", "").trim()
		});
	}

	return anchors;
}
