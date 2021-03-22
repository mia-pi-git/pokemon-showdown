/**
 * Basic plugin to make users confirm they've read the rules.
 * In a plugin for modularity purposes.
 * @author mia-pi-git
*/

interface RulesRequest {
	time: number;
	unregged?: boolean;
	timer?: NodeJS.Timer;
	confirmed?: boolean;
}

const MESSAGES = {
	request: `|uhtml|confirm|<div class="message-error">You must read the Rules before you can chat.</div>`,
	confirmerequest: (
		'|uhtmlchange|confirm|' +
		'<button class="button" name="send" value="/confirmrules">I confirm I have read the rules and will abide by them.</button>'
	),
}

function replyTo(message: string, context: CommandContext) {
	if (context.room) {
		context.user.sendTo(context.room.roomid, message);
	} else {
		context.user.send(message);
	}
}

export const confirmed = Chat.oldPlugins.rules?.confirmed || new Map<ID, RulesRequest>();

export const confirmedPruneTimer = setInterval(() => {
	for (const [id, {unregged, timer}] of confirmed) {
		if (!Users.get(id) && unregged) {
			confirmed.delete(id);
			if (timer) clearTimeout(timer);
		}
	}
}, 10 * 60 * 60 * 1000);

export const chatfilter: ChatFilter = function (message, user, room) {
	if (!user.trusted) {
		const existing = confirmed.get(user.id);
		if (!existing || !existing.confirmed && !existing.timer) {
			replyTo(MESSAGES.request, this);
			this.parse(`/rules`);

			const timer = setTimeout(() => {
				replyTo(MESSAGES.confirmerequest, this);
			}, 7 * 60 * 1000);

			confirmed.set(user.id, {
				timer, confirmed: false,
				unregged: !user.registered,
				time: Date.now(),
			});
			return false;
		}
	}
	return undefined;
}

export const destroy = () => clearTimeout(confirmedPruneTimer);

export const commands: ChatCommands = {
	confirmrules(target, room, user) {
		const existing = confirmed.get(user.id);
		if (existing?.confirmed) {
			return this.errorReply(`You have already confirmed you have read the rules.`);
		}
		confirmed.set(user.id, {
			time: Date.now(),
			unregged: !user.registered,
			confirmed: true,
		});
		this.popupReply(`You have confirmed you have read the rules.`);
	},
}
