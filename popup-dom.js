function addLink(result, resultsIndex) {
	var id = 'link_' + resultsIndex;
	var label = result.title;
	if (!label) {
		label = result.url.split('/').pop().replace(/_/g, ' ');
	}

	var liTemplate = `<li>
		<input type="checkbox" value="" id="${id}" data-ext="${result.extIndexes.join(',')}" data-idx="${resultsIndex}">
		<label for="${id}" data-title="${label}"><h3>${label}</h3></label>
		<span data-ending></span>
		<span data-size></span>
	</li>`;

	var doc = parser.parseFromString(liTemplate, 'text/html');
	var li = doc.querySelector('li');
	downloadsList.appendChild(li);

	applySelectedExtensionsToList();
}
function addExtension(e, extIndex) {
	var extId = 'ext_'+extIndex;
	var liTemplate = `<li>
			<input type="checkbox" value="${extIndex}" id="${extId}" data-name="${e.name}">
			<label for="${extId}" title="${e.name}">${e.ending}</label>
			<span data-counter></span>
		</li>`;
	var doc = parser.parseFromString(liTemplate, 'text/html');
	var li = doc.querySelector('li');
	li.querySelector('input').addEventListener('change', onExtensionCheckboxChange);
	extList.appendChild(li);
}

function setLinkValues(linkInput, checked, extIndex) {	
	linkInput.checked = checked;

	let value = '';
	let labelClass = '';
	let size = '';
	let extension = {ending: ''};

	if (checked) {
		const resIdx = linkInput.getAttribute('data-idx');
		const downloadData = tabState.results[resIdx].downloadUrls.find(u=>u.extIdx == extIndex);
		if (!downloadData) {
			console.warn('no extidx '+extIndex+' for residx='+resIdx, tabState.results[resIdx].downloadUrls);
			return;
		}
		extension = tabState.extensions[extIndex];
		value = downloadData.url;
			
		labelClass = 'matched';
		size = downloadData.size;
		if (size) {
			size = size.replace('.0', '');
		}
	}

	linkInput.disabled = !checked;	
	linkInput.value = value;
	
	var label = linkInput.nextElementSibling;
	label.className = labelClass;
	label.title = label.getAttribute('data-title');
	
	var span = label.nextElementSibling;
	span.innerText = extension.ending;

	var span = span.nextElementSibling;
	span.innerHTML = `<b>${size}</b>`;
	linkInput.setAttribute('data-size', size);

	addInfoAboutPossibleExtensions(linkInput, label);
	 
}


