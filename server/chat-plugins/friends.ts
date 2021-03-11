/**
 * Friends list plugin.
 * Allows for adding and removing friends, as well as seeing their activity.
 * Written by Mia.
 * @author mia-pi-git
 */

import {Utils} from '../../lib/utils';
import {FriendsDatabase, MAX_REQUESTS, sendPM} from '../friends';

const STATUS_COLORS: {[k: string]: string} = {
	idle: '#ff7000',
	online: '#009900',
	busy: '#cc3838',
};

const STATUS_TITLES: {[k: string]: string} = {
	online: 'Online',
	idle: 'Idle',
	busy: 'Busy',
	offline: 'Offline',
};

export const Friends = new class {
	database: FriendsDatabase;
	constructor() {
		this.database = new FriendsDatabase();
	}
	async notifyPending(user: User) {
		if (user.settings.blockFriendRequests) return;
		const friendRequests = await this.database.getRequests(user);
		const pendingCount = friendRequests.received.size;
		if (pendingCount < 1) return;
		sendPM(`/nonotify You have ${pendingCount} friend requests pending!`, user.id);
		sendPM(`/raw <button class="button" name="send" value="/j view-friends-received">View</button></div>`, user.id);
	}
	async notifyConnection(user: User) {
		const connected = await this.database.getLastLogin(user.id);
		if ((Date.now() - connected) < 2 * 60 * 1000) {
			return;
		}
		const friends = await this.database.getFriends(user.id);
		const message = `/nonotify Your friend ${Utils.escapeHTML(user.name)} has just connected!`;
		for (const f of friends) {
			const {user1, user2} = f;
			const friend = user1 !== user.id ? user1 : user2;
			const curUser = Users.get(friend as string);
			if (curUser?.settings.allowFriendNotifications) {
				curUser.send(`|pm|&|${curUser.getIdentity()}|${message}`);
			}
		}
	}
	writeLogin(user: User) {
		return this.database.writeLogin(user.id);
	}
	hideLoginData(user: User) {
		return this.database.hideLoginData(user.id);
	}
	allowLoginData(user: User) {
		return this.database.allowLoginData(user.id);
	}
	async visualizeList(userid: ID) {
		const friends = await this.database.getFriends(userid);
		if (!friends.length) {
			return `<h3>Your friends:</h3> <h4>None.</h4>`;
		}
		const categorized: {[k: string]: string[]} = {
			online: [],
			idle: [],
			busy: [],
			offline: [],
		};
		const loginTimes: {[k: string]: number} = {};
		for (const {friend: friendID, last_login, allowing_login} of [...friends].sort()) {
			const friend = Users.get(friendID);
			if (friend?.connected) {
				categorized[friend.statusType].push(friend.id);
			} else {
				categorized.offline.push(friendID);
				if (!allowing_login) {
					loginTimes[friendID] = last_login;
				}
			}
		}

		const sorted = Object.keys(categorized)
			.filter(item => categorized[item].length > 0)
			.map(item => `${STATUS_TITLES[item]} (${categorized[item].length})`);

		let buf = `<h3>Your friends: <small> `;
		if (sorted.length > 0) {
			buf += `Total (${friends.length}) | ${sorted.join(' | ')}`;
		} else {
			buf += `</h3><em>you have no friends added on Showdown lol</em><br /><br /><br />`;
			buf += `<strong>To add a friend, use </strong><code>/friend add [username]</code>.<br /><br />`;
			return buf;
		}
		buf += `</h3> `;

		for (const key in categorized) {
			const friendArray = categorized[key].sort();
			if (friendArray.length === 0) continue;
			buf += `<h4>${STATUS_TITLES[key]} (${friendArray.length})</h4>`;
			for (const friend of friendArray) {
				const friendID = toID(friend);
				buf += `<div class="pad"><div>`;
				buf += this.displayFriend(friendID, loginTimes[friendID]);
				buf += `</div></div>`;
			}
		}

		return buf;
	}
	// much more info redacted
	async visualizePublicList(userid: ID) {
		const friends: string[] = (await this.database.getFriends(userid) as any[]).map(f => f.friend);
		let buf = `<h3>${userid}'s friends:</h3><hr />`;
		if (!friends.length) {
			buf += `None.`;
			return buf;
		}
		for (const friend of friends) {
			buf += `- <username>${friend}</username><br />`;
		}
		return buf;
	}
	displayFriend(userid: ID, login?: number) {
		const user = Users.getExact(userid); // we want this to be exact
		const name = Utils.escapeHTML(user ? user.name : userid);
		const statusType = user?.connected ?
			`<strong style="color:${STATUS_COLORS[user.statusType]}">\u25C9 ${STATUS_TITLES[user.statusType]}</strong>` :
			'\u25CC Offline';
		let buf = user ?
			`<span class="username"> <username>${name}</username></span><span><small> (${statusType})</small></span>` :
			Utils.html`<i>${name}</i> <small>(${statusType})</small>`;
		buf += `<br />`;

		const curUser = Users.get(userid); // might be an alt
		if (user) {
			if (user.userMessage) buf += Utils.html`Status: <i>${user.userMessage}</i><br />`;
		} else if (curUser && curUser.id !== userid) {
			buf += `<small>On an alternate account</small><br />`;
		}
		if (login && typeof login === 'number' && !user?.connected) {
			// THIS IS A TERRIBLE HACK BUT IT WORKS OKAY
			const time = Chat.toTimestamp(new Date(Number(login)), {human: true});
			buf += `Last login: ${time.split(' ').reverse().join(', on ')}`;
			buf += ` (${Chat.toDurationString(Date.now() - login, {precision: 1})} ago)`;
		} else if (typeof login === 'string') {
			buf += `${login}`;
		}
		buf = `<div class="infobox">${buf}</div>`;
		return toLink(buf);
	}
	checkCanUse(context: CommandContext | PageContext) {
		const user = context.user;
		if (user.locked || user.namelocked || user.semilocked || user.permalocked) {
			throw new Chat.ErrorMessage(`You are locked, and so cannot use the friends feature.`);
		}
		if (!user.autoconfirmed) {
			throw new Chat.ErrorMessage(context.tr`You must be autoconfirmed to use the friends feature.`);
		}
		if (!Config.usesqlitefriends || !Config.usesqlite) {
			throw new Chat.ErrorMessage(`The friends list feature is currently disabled.`);
		}
		if (!Users.globalAuth.atLeast(user, Config.usesqlitefriends)) {
			throw new Chat.ErrorMessage(`You are currently unable to use the friends feature.`);
		}
	}
	request(user: User, receiver: ID) {
		return this.database.request(user, receiver);
	}
	removeFriend(userid: ID, friendID: ID) {
		return this.database.removeFriend(userid, friendID);
	}
	approveRequest(receiverID: ID, senderID: ID) {
		return this.database.approveRequest(receiverID, senderID);
	}
	removeRequest(receiverID: ID, senderID: ID) {
		return this.database.removeRequest(receiverID, senderID);
	}
};

/** UI functions chiefly for the chat page. */

function toLink(buf: string) {
	return buf.replace(/<a roomid="/g, `<a target="replace" href="/`);
}

function headerButtons(type: string, user: User) {
	const buf = [];
	const icons: {[k: string]: string} = {
		sent: '<i class="fa fa-paper-plane"></i>',
		received: '<i class="fa fa-get-pocket"></i>',
		all: '<i class="fa fa-users"></i>',
		help: '<i class="fa fa-question-circle"></i>',
		settings: '<i class="fa fa-cog"></i>',
	};
	const titles: {[k: string]: string} = {
		all: 'All Friends',
		sent: 'Sent',
		received: 'Received',
		help: 'Help',
		settings: 'Settings',
	};
	for (const page in titles) {
		const title = titles[page];
		const icon = icons[page];
		if (page === type) {
			buf.push(`${icon} <strong>${user.tr(title)}</strong>`);
		} else {
			buf.push(`${icon} <a roomid="view-friends-${page}">${user.tr(title)}</a>`);
		}
	}
	const refresh = (
		`<button class="button" name="send" value="/j view-friends${type?.trim() ? `-${type}` : ''}" style="float: right">` +
		` <i class="fa fa-refresh"></i> ${user.tr('Refresh')}</button>`
	);
	return `<div style="line-height:25px">${buf.join(' / ')}${refresh}</div>`;
}

export const commands: ChatCommands = {
	unfriend(target) {
		return this.parse(`/friend remove ${target}`);
	},
	friend: 'friends',
	friendslist: 'friends',
	friends: {
		''(target) {
			return this.parse(`/friends list`);
		},
		viewlist(target, room, user) {
			Friends.checkCanUse(this);
			target = toID(target);
			if (!target) return this.errorReply(`Specify a user.`);
			if (target === user.id) return this.parse(`/friends list`);
			return this.parse(`/j view-friends-viewuser-${target}`);
		},
		request: 'add',
		async add(target, room, user, connection) {
			Friends.checkCanUse(this);
			target = toID(target);
			if (target.length > 18) {
				return this.errorReply(this.tr`That name is too long - choose a valid name.`);
			}
			if (!target) return this.parse('/help friends');
			await Friends.request(user, target as ID);
			if (connection.openPages?.has('friends-sent')) {
				this.parse(`/join view-friends-sent`);
			}
			return this.sendReply(this.tr`You sent a friend request to '${target}'.`);
		},
		unfriend: 'remove',
		async remove(target, room, user) {
			Friends.checkCanUse(this);
			target = toID(target);
			if (!target) return this.parse('/help friends');
			await Friends.removeFriend(user.id, target as ID);
			return this.sendReply(this.tr`Removed friend '${target}'.`);
		},
		view(target) {
			return this.parse(`/join view-friends-${target}`);
		},
		list() {
			return this.parse(`/join view-friends`);
		},
		async accept(target, room, user, connection) {
			Friends.checkCanUse(this);
			target = toID(target);
			if (user.settings.blockFriendRequests) {
				return this.errorReply(this.tr`You are currently blocking friend requests, and so cannot accept your own.`);
			}
			if (!target) return this.parse('/help friends');
			await Friends.approveRequest(user.id, target as ID);
			const targetUser = Users.get(target);
			sendPM(`You accepted a friend request from "${target}".`, user.id);
			if (connection.openPages?.has('friends-received')) {
				this.parse(`/j view-friends-received`);
			}
			if (targetUser) sendPM(`/text ${user.name} accepted your friend request!`, targetUser.id);
		},
		deny: 'reject',
		async reject(target, room, user, connection) {
			Friends.checkCanUse(this);
			target = toID(target);
			if (!target) return this.parse('/help friends');
			await Friends.removeRequest(user.id, target as ID);
			if (connection.openPages?.has('friends-received')) {
				this.parse(`/j view-friends-received`);
			}
			return sendPM(this.tr`You denied a friend request from '${target}'.`, user.id);
		},
		toggle(target, room, user, connection) {
			Friends.checkCanUse(this);
			const setting = user.settings.blockFriendRequests;
			target = target.trim();
			if (this.meansYes(target)) {
				if (!setting) return this.errorReply(this.tr`You already are allowing friend requests.`);
				user.settings.blockFriendRequests = false;
				this.sendReply(this.tr`You are now allowing friend requests.`);
			} else if (this.meansNo(target)) {
				if (setting) return this.errorReply(this.tr`You already are blocking incoming friend requests.`);
				user.settings.blockFriendRequests = true;
				this.sendReply(this.tr`You are now blocking incoming friend requests.`);
			} else {
				if (target) this.errorReply(this.tr`Unrecognized setting.`);
				this.sendReply(
					this.tr(setting ? `You are currently blocking friend requests.` : `You are not blocking friend requests.`)
				);
			}
			if (connection.openPages?.has('friends-settings')) {
				this.parse(`/j view-friends-settings`);
			}
			user.update();
		},
		async undorequest(target, room, user, connection) {
			Friends.checkCanUse(this);
			target = toID(target);
			if (user.settings.blockFriendRequests) {
				return sendPM(
					`/error ${this.tr`You are blocking friend requests, and so cannot undo requests, as you have none.`}`, user.id
				);
			}
			await Friends.removeRequest(target as ID, user.id);
			if (connection.openPages?.has('friends-sent')) {
				this.parse(`/j view-friends-sent`);
			}
			return sendPM(this.tr`You removed your friend request to '${target}'.`, user.id);
		},
		hidenotifs: 'viewnotifications',
		hidenotifications: 'viewnotifications',
		viewnotifs: 'viewnotifications',
		viewnotifications(target, room, user, connection, cmd) {
			Friends.checkCanUse(this);
			const setting = user.settings.allowFriendNotifications;
			target = target.trim();
			if (!cmd.includes('hide') || target && this.meansYes(target)) {
				if (setting) return this.errorReply(this.tr(`You are already allowing friend notifications.`));
				user.settings.allowFriendNotifications = true;
				this.sendReply(this.tr(`You will now receive friend notifications.`));
			} else if (cmd.includes('hide') || target && this.meansNo(target)) {
				if (!setting) return this.errorReply(this.tr`You are already not receiving friend notifications.`);
				user.settings.allowFriendNotifications = false;
				this.sendReply(this.tr`You will not receive friend notifications.`);
			} else {
				if (target) this.errorReply(this.tr`Unrecognized setting.`);
				this.sendReply(
					this.tr(setting ? `You are currently allowing friend notifications.` : `Your friend notifications are disabled.`)
				);
			}
			if (connection.openPages?.has('friends-settings')) {
				this.parse(`/j view-friends-settings`);
			}
			user.update();
		},
		hidelogins: 'togglelogins',
		showlogins: 'togglelogins',
		async togglelogins(target, room, user, connection, cmd) {
			Friends.checkCanUse(this);
			const setting = user.settings.hideLogins;
			if (cmd.includes('hide')) {
				if (setting) return this.errorReply(this.tr`You are already hiding your logins from friends.`);
				user.settings.hideLogins = true;
				await Friends.hideLoginData(user);
				this.sendReply(`You are now hiding your login times from your friends.`);
			} else if (cmd.includes('show')) {
				if (!setting) return this.errorReply(this.tr`You are already allowing friends to see your login times.`);
				user.settings.hideLogins = false;
				await Friends.allowLoginData(user);
				this.sendReply(`You are now allowing your friends to see your login times.`);
			} else {
				return this.errorReply(`Invalid setting.`);
			}
			if (connection.openPages?.has('friends-settings')) {
				this.parse(`/j view-friends-settings`);
			}
			user.update();
		},
		async listdisplay(target, room, user, connection) {
			Friends.checkCanUse(this);
			target = toID(target);
			const {public_list: setting} = await Friends.database.getSettings(user.id);
			if (this.meansYes(target)) {
				if (setting) {
					return this.errorReply(this.tr`You are already allowing other people to view your friends list.`);
				}
				await Friends.database.setHideList(user.id, true);
				if (connection.openPages?.has('friends-settings')) {
					this.parse(`/j view-friends-settings`);
				}
				return this.sendReply(this.tr`You are now allowing other people to view your friends list.`);
			} else if (this.meansNo(target)) {
				if (!setting) {
					return this.errorReply(this.tr`You are already hiding your friends list.`);
				}
				await Friends.database.setHideList(user.id, false);
				if (connection.openPages?.has('friends-settings')) {
					this.parse(`/j view-friends-settings`);
				}
				return this.sendReply(this.tr`You are now hiding your friends list.`);
			}
			this.sendReply(`You are currently ${setting ? 'displaying' : 'hiding'} your friends list.`);
		},
	},
	friendshelp() {
		return this.parse('/join view-friends-help');
	},
};

export const pages: PageTable = {
	async friends(args, user) {
		if (!user.named) return Rooms.RETRY_AFTER_LOGIN;
		Friends.checkCanUse(this);
		const type = args.shift();
		let buf = '<div class="pad">';
		switch (toID(type)) {
		case 'outgoing': case 'sent':
			this.title = `[Friends] Sent`;
			buf += headerButtons('sent', user);
			buf += `<hr />`;
			if (user.settings.blockFriendRequests) {
				buf += `<h3>${this.tr(`You are currently blocking friend requests`)}.</h3>`;
				return buf;
			}
			const {sent} = await Friends.database.getRequests(user);
			if (sent.size < 1) {
				buf += `<strong>You have no outgoing friend requests pending.</strong><br />`;
				buf += `<br />To add a friend, use <code>/friend add [username]</code>.`;
				buf += `</div>`;
				return toLink(buf);
			}
			buf += `<h3>You have ${Chat.count(sent.size, 'friend requests')} pending${sent.size === MAX_REQUESTS ? ` (maximum reached)` : ''}.</h3>`;
			for (const request of sent) {
				buf += `<br /><div class="infobox">`;
				buf += `<strong>${request}</strong>`;
				buf += ` <button class="button" name="send" value="/friends undorequest ${request}">`;
				buf += `<i class="fa fa-undo"></i> ${this.tr('Undo')}</button>`;
				buf += `</div>`;
			}
			break;
		case 'received': case 'incoming':
			this.title = `[Friends] Received`;
			buf += headerButtons('received', user);
			buf += `<hr />`;
			const {received} = await Friends.database.getRequests(user);
			if (received.size < 1) {
				buf += `<strong>You have no pending friend requests.</strong>`;
				buf += `</div>`;
				return toLink(buf);
			}
			buf += `<h3>You have ${received.size} pending friend requests.</h3>`;
			for (const request of received) {
				buf += `<br /><div class="infobox">`;
				buf += `<strong>${request}</strong>`;
				buf += ` <button class="button" name="send" value="/friends accept ${request}">${this.tr('Accept')}</button> |`;
				buf += ` <button class="button" name="send" value="/friends reject ${request}">${this.tr('Deny')}</button>`;
				buf += `</div>`;
			}
			break;
		case 'viewuser':
			const target = toID(args.shift());
			if (!target) return this.errorReply(`Specify a user.`);
			if (target === user.id) {
				return this.errorReply(`Use /friends list to view your own list.`);
			}
			const {public_list: isAllowing} = await Friends.database.getSettings(target);
			if (!isAllowing) return this.errorReply(`${target}'s friends list is not public or they do not have one.`);
			this.title = `[Friends List] ${target}`;
			buf += await Friends.visualizePublicList(target);
			break;
		case 'help':
			this.title = `[Friends] Help`;
			buf += headerButtons('help', user);
			buf += `<hr /><h3>Help</h3>`;
			buf += `<strong>/friend OR /friends OR /friendslist:</strong><br /><ul><li>`;
			buf += [
				`<code>/friend list</code> - View current friends.`,
				`<code>/friend add [username]</code> - Send a friend request to [username], if you don't have them added.`,
				`<code>/friend remove [username]</code> OR <code>/unfriend [username]</code>  - Unfriend the user.`,
				`<code>/friend accept [username]</code> - Accepts the friend request from [username], if it exists.`,
				`<code>/friend reject [username]</code> - Rejects the friend request from [username], if it exists.`,
				`<code>/friend toggle [off/on]</code> - Enable or disable receiving of friend requests.`,
				`<code>/friend hidenotifications</code> OR <code>hidenotifs</code> - Opts out of receiving friend notifications.`,
				`<code>/friend viewnotifications</code> OR <code>viewnotifs</code> - Opts into view friend notifications.`,
				`<code>/friend listdisplay [on/off]</code> - Opts [in/out] of letting others view your friends list.`,
				`<code>/friend viewlist [user]</code> - View the given [user]'s friend list, if they're allowing others to see.`,
			].join('</li><li>');
			buf += `</li></ul>`;
			break;
		case 'settings':
			this.title = `[Friends] Settings`;
			buf += headerButtons('settings', user);
			buf += `<hr /><h3>Friends Settings:</h3>`;
			const settings = user.settings;
			const {public_list} = await Friends.database.getSettings(user.id);
			buf += `<strong>Notify me when my friends come online:</strong><br />`;
			buf += `<button class="button${settings.allowFriendNotifications ? `` : ` disabled`}" name="send" `;
			buf += `value="/friends hidenotifs">Disable</button> `;
			buf += `<button class="button${settings.allowFriendNotifications ? ` disabled` : ``}" name="send" `;
			buf += `value="/friends viewnotifs">Enable</button> <br /><br />`;
			buf += `<strong>Receive friend requests:</strong><br />`;
			buf += `<button class="button${settings.blockFriendRequests ? ` disabled` : ''}" name="send" `;
			buf += `value="/friends toggle off">Disable</button> `;
			buf += `<button class="button${settings.blockFriendRequests ? `` : ` disabled`}" name="send" `;
			buf += `value="/friends toggle on">Enable</button> <br /><br />`;
			buf += `<strong>Allow others to see your list:</strong><br />`;
			buf += `<button class="button${public_list ? ` disabled` : ''}" name="send" `;
			buf += `value="/friends listdisplay yes">Allow</button> `;
			buf += `<button class="button${public_list ? `` : ` disabled`}" name="send" `;
			buf += `value="/friends listdisplay no">Hide</button> <br /><br />`;
			break;
		default:
			this.title = `[Friends] All Friends`;
			buf += headerButtons('all', user);
			buf += `<hr />`;
			buf += await Friends.visualizeList(user.id);
		}
		buf += `</div>`;
		return toLink(buf);
	},
};

export const loginfilter: LoginFilter = async user => {
	if (!Config.usesqlitefriends || !Users.globalAuth.atLeast(user, Config.usesqlitefriends)) {
		return;
	}
	// notify users of pending requests
	await Friends.notifyPending(user);

	// (quietly) notify their friends (that have opted in) that they are online
	await Friends.notifyConnection(user);
	// write login time
	await Friends.writeLogin(user);
};
