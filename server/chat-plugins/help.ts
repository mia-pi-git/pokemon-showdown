import {FS} from '../../lib/fs';
const helpRoom = Rooms.get('help');

export class HelpAnswerer {
	query(question: string) {
		// placed internally so it refreshes rfaqs on each call, not just on a chat hotpatch/restart
		const roomFaqs = JSON.parse(FS('config/chat-plugins/faqs.json').readIfExistsSync() || "{}");
		const faqs: string[] = Object.keys(roomFaqs[helpRoom!.roomid]).filter(item => roomFaqs['help'][item]);
		for (let faq of faqs) {
			if (this.match(question, faq)) {
				faq = this.getFaqID(faq);
				return roomFaqs['help'][faq];
			}
		}
		return null;
	}
	visualize(question: string, command?: boolean) {
		const response = this.query(question);
		if (response) {
			let buf = '';
			buf += Chat.html`<strong>You asked:</strong> ${question}<br />`;
			buf += `<strong>Our best reply:</strong> ${Chat.formatText(response)}`;
			question = Chat.escapeHTML(question);
			if (!command) {
				buf += `<hr /><button class="button" name="send" value="A: ${question}">Ask the Help room if this wasn't accurate</button>`;
			}
			return buf;
		} else {
			return null;
		}
	}
	getFaqID(faq: string) {
		const roomFaqs = JSON.parse(FS('config/chat-plugins/faqs.json').readIfExistsSync() || "{}");
		const alias = roomFaqs['help'][faq];
		if (!alias || faq.length <= 4) return; // ignore short aliases, they cause too many false positives
		if (!alias.startsWith('>')) return faq; // not an alias
		return alias.replace('>', '');
	}
	match(question: string, query: string) {
		let faqRegex = '';
		if (query.length > 4) {
			for (const term of query.split('')) {
				if (!term.trim()) {
					faqRegex += ' ';
					continue;
				}
				faqRegex += `(?=.*?(${term}))`;
			}
		} else {
			faqRegex = `[^a-zA-Z0-9]${toID(query).split('').join('[^a-zA-Z0-9]*')}([^a-zA-Z0-9]|\\z)`;
		}
		return new RegExp(faqRegex).test(question);
	}
}

export const chatfilter: ChatFilter = (message, user, room) => {
	const Help = new HelpAnswerer();
	if (room?.roomid === 'help' && !user.can('broadcast', null, room)) {
		const reply = Help.visualize(message, true);
		if (!reply) {
			return message;
		} else {
			if (message.startsWith('A:')) return message.replace('A:', '');
			user.sendTo(room.roomid, `|uhtml|askhelp-${user}|<div class="infobox">${reply}</div>`);
			setTimeout(() => {
				const full = Help.visualize(message);
				user.sendTo(room.roomid, `|uhtml|askhelp-${user}|<div class="infobox">${full}</div>`);
			}, 10 * 1000);
			return false;
		}
	}
};

export const commands: ChatCommands = {
	'!question': true,
	question(target, room, user) {
		const Help = new HelpAnswerer();
		if (!target) return this.parse("/help question");
		const reply = Help.visualize(target, true);
		if (!Help.query(target)) return this.sendReplyBox(`No answer found.`);
		this.runBroadcast();
		this.sendReplyBox(reply!);
	},
	questionhelp: ["/question [question] - Asks the Help Room auto-response plugin a question."],
};
