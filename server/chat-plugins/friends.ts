/**
 * Friends list plugin.
 * Allows for adding and removing friends, as well as seeing their activity.
 * Written by Mia-pi.
 * @author mia-pi-git
 */
import * as Sqlite from 'better-sqlite3';
import {Utils} from '../../lib/utils';
import {FS} from '../../lib/fs';
import {QueryProcessManager} from '../../lib/process-manager';
import {Repl} from '../../lib/repl';
import {Chat} from '../chat';

/** Max friends per user */
const MAX_FRIENDS = 100;
/** Max friend requests. */
const MAX_REQUESTS = 6;
const REQUEST_EXPIRY_TIME = 30 * 24 * 60 * 60 * 1000;
const MAX_PROCESSES = 1;
/** `Map<transferTo, transferFrom>` */
export const transferRequests: Map<string, string> = Chat.oldPlugins.friends?.transferRequests || new Map();

interface DatabaseRequest {
	statement: string;
	type: 'all' | 'get' | 'run' | 'exec';
	data: AnyObject | any[];
}

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

const ACTIONS: {[k: string]: string} = {
	add: (
		`REPLACE INTO friends (userid, friend, last_login) VALUES($userid, $friend, $login) ON CONFLICT (userid, friend) ` +
		`DO UPDATE SET userid = $userid, friend = $friend`
	),
	get: `SELECT * FROM friends WHERE userid = ? LIMIT ?`,
	delete: `DELETE FROM friends WHERE userid = $userid OR friend = $userid`,
	getSent: `SELECT receiver, sender FROM friend_requests WHERE sender = ?`,
	getReceived: `SELECT receiver, sender FROM friend_requests WHERE receiver = ?`,
	insertRequest: `INSERT INTO friend_requests(sender, receiver, sent_at) VALUES(?, ?, ?)`,
	deleteRequest: `DELETE FROM friend_requests WHERE sender = ? AND receiver = ?`,
	findFriendship: `SELECT * FROM friends WHERE (friend = $user1 AND userid = $user2) OR (userid = $user1 AND friend = $user2)`,
	renameFriend: `UPDATE OR IGNORE friends SET friend = $newID WHERE friend = $oldID`,
	renameUserid: `UPDATE OR IGNORE friends SET userid = $newID WHERE userid = $oldID`,
	rename: `REPLACE INTO friend_renames (original_name, new_name, change_date) VALUES(?, ?, ?)`,
	login: `UPDATE friends SET last_login = ? WHERE friend = ?`,
	checkLastLogin: `SELECT last_login FROM friends WHERE friend = ?`,
	deleteLogin: `UPDATE friends SET last_login = null WHERE friend = ?`,
}

export const Friends = new class {
	/** `Map<oldID, newID> */
	renames: Map<string, string>;
	readonly database: Sqlite.Database;
	constructor() {
		try {
			this.database = new Sqlite(`${__dirname}/../../databases/friends.db`, {fileMustExist: true});
		} catch (e) {
			this.database = new Sqlite(`${__dirname}/../../databases/friends.db`);
			this.database.exec(FS('databases/schemas/friends.sql').readSync());
		}
		this.renames = this.getRenames();
		// preparing these once is apparently faster
		this.checkExpiringRequests();
	}
	checkExpiringRequests() {
		// requests expire after one month. this is checked both on intialization
		// (hotpatch, to ensure accuracy in case they both don't log in)
		// and when the user the request is sent to / sent from logs in.
		const results = this.database.prepare(`SELECT * FROM friend_requests`).all();
		const removed = [];
		for (const request of results) {
			if ((Date.now() - request.sent_at) > REQUEST_EXPIRY_TIME) {
				// expires after a month
				this.removeRequest(request.receiver, request.sender);
				removed.push(request);
			}
		}
		return removed;
	}
	async getFriends(user: User) {
		if (user.friends) return; // only query once per user object
		const results = await PM.query({
			statement: 'get', type: 'all', data: [user.id, MAX_FRIENDS],
		})
		const friends = new Set(results.map((item: AnyObject) => item.friend));
		user.friends = friends as Set<string>;
		return friends;
	}
	async getRequests(user: User) {
		const sent: Set<string> = new Set();
		const received: Set<string> = new Set();
		if (user.settings.blockFriendRequests) {
			// delete any pending requests that may have been sent to them while offline and return
			await PM.query({
				statement: 'deleteRequest', type: 'all', data: [user.id],
			});
			user.friendRequests = null;
			return;
		}
		const sentResults = await PM.query({
			statement: 'getSent', type: 'all', data: [user.id],
		});
		for (const request of sentResults) {
			if ((Date.now() - request.sent_at) > (30 * 24 * 60 * 60 * 1000)) {
				// expires after a month
				this.removeRequest(request.receiver, request.sender);
				continue;
			}
			sent.add(request.receiver);
		}
		const receivedResults = await PM.query({
			statement: 'getReceived', data: [user.id], type: 'all',
		});
		for (const request of receivedResults) {
			received.add(request.sender);
		}
		user.friendRequests = {sent, received};
		return {sent, received};
	}
	getRenames() {
		// this is only run once, on initialization, so it doesn't need to be in statements
		const results = this.database.prepare(`SELECT * FROM friend_renames`).all();
		const renames: Map<string, string> = new Map();
		for (const result of results) {
			const {original_name, new_name} = result;
			renames.set(new_name, original_name);
		}
		return renames;
	}
	async request(user: User, receiverName: string) {
		const receiverID = toID(receiverName);
		if (!user.friends) user.friends = new Set();
		if (user.friends.size >= MAX_FRIENDS) {
			throw new Chat.ErrorMessage(`You are at the maximum number of friends.`);
		}
		if (!receiverID) throw new Chat.ErrorMessage(`Invalid name.`);
		if (receiverID === user.id) throw new Chat.ErrorMessage(`You cannot friend yourself.`);
		const sentRequests = user.friendRequests?.sent;
		if (await this.hasFriendship(user.id, receiverID)) {
			throw new Chat.ErrorMessage(`You are already friends with '${receiverID}'.`);
		}
		if (sentRequests?.has(receiverID)) {
			throw new Chat.ErrorMessage(`You have already sent a friend request to '${receiverID}'.`);
		}
		if (sentRequests!.size >= MAX_REQUESTS) {
			throw new Chat.ErrorMessage(
				`You already have ${MAX_REQUESTS} outgoing friend requests. Use "/friends view sent" to see your outgoing requests.`
			);
		}
		if (user.friends.has(receiverID)) {
			throw new Chat.ErrorMessage(`You have already friended '${receiverID}'.`);
		}

		const receiver = Users.get(receiverID);
		if (receiver?.settings.blockFriendRequests) {
			throw new Chat.ErrorMessage(`${receiver.name} is blocking friend requests.`);
		}
		let buf = Utils.html`/raw <button class="button" name="send" value="/friends accept ${user.id}">Accept</button> | `;
		buf += Utils.html`<button class="button" name="send" value="/friends reject ${user.id}">Deny</button><br /> `;
		buf += `<small>(You can also stop this user from sending you friend requests with <code>/ignore</code>)</small>`;
		const disclaimer = (
			`/raw <small>Note: If this request is accepted, your friend will be notified when you come online, ` +
			`and you will be notified when they do, unless you opt out of receiving them.</small>`
		);

		if (receiver) {
			if (!receiver.friendRequests) {
				throw new Chat.ErrorMessage(`This user is blocking friend requests.`);
			}
			if (receiver.settings.blockPMs) {
				throw new Chat.ErrorMessage(`This user is blocking PMs, and cannot be friended right now.`);
			}
			if (receiver.friendRequests.sent.has(user.id)) {
				// if the sender is trying to friend the receiver, and the receiver is trying to friend the sender
				// it seems like they might want to be friends, so let's just approve the request and create the friendship
				return this.approveRequest(receiver, user.id);
			}
			this.sendPM(`/text ${Utils.escapeHTML(user.name)} sent you a friend request!`, receiver.id);
			this.sendPM(buf, receiver.id);
			this.sendPM(disclaimer, receiver.id);
			receiver.friendRequests.received?.add(user.id);
		}
		this.sendPM(`/text You sent a friend request to ${receiver?.connected ? receiver.name : receiverID}!`, user.id);
		this.sendPM(
			`/raw <button class="button" name="send" value="/friends undorequest ${Utils.escapeHTML(receiverID)}">` +
			`<i class="fa fa-undo"></i> Undo</button>`, user.id
		);
		this.sendPM(disclaimer, user.id);
		await PM.query({
			statement: 'insertRequest', data: [user.id, receiverID, Date.now()], type: 'run',
		});
		return sentRequests?.add(receiverID);
	}
	async removeRequest(receiverName: string, senderName: string) {
		const senderID = toID(senderName);
		const receiverID = toID(receiverName);
		if (!senderID) throw new Chat.ErrorMessage(`Invalid sender username.`);
		if (!receiverID) throw new Chat.ErrorMessage(`Invalid receiver username.`);

		const sender = Users.get(senderID);
		const receiver = Users.get(receiverID);

		if (sender?.friendRequests) {
			const {sent} = sender.friendRequests;
			sent.delete(receiverID);
		}
		if (receiver?.friendRequests) {
			const {received} = receiver.friendRequests;
			received?.delete(senderID);
		}
		return PM.query({
			statement: 'deleteRequest', data: [senderID, receiverID], type: 'run',
		});
	}
	async approveRequest(receiver: User, senderName: string) {
		const senderID = toID(senderName);
		if (!receiver.friendRequests?.received?.has(senderID)) {
			throw new Chat.ErrorMessage(`You have not received a friend request from '${senderID}'.`);
		}
		await this.removeRequest(receiver.id, senderID);
		await this.addFriend(senderID, receiver.id);
	}
	async visualizeList(user: User) {
		if (!user.friends) {
			return `<h3>Your friends:</h3> <h4>None.</h4>`;
		}
		const friends: {[k: string]: string[]} = {
			online: [],
			idle: [],
			busy: [],
			offline: [],
		};
		for (const friendName of [...user.friends].sort()) {
			const friend = Users.get(friendName);
			if (friend?.connected) {
				friends[friend.statusType].push(friend.id);
			} else {
				friends.offline.push(toID(friendName));
			}
		}
		const sorted = Object.keys(friends)
			.filter(item => friends[item].length > 0)
			.map(item => `${STATUS_TITLES[item]} (${friends[item].length})`);
		let buf = `<h3>Your friends: <small> `;
		if (sorted.length > 0) {
			buf += `Total (${user.friends.size}) | ${sorted.join(' | ')}`;
		} else {
			buf += `</h3><em>you have no friends added on Showdown lol</em><br /><br /><br />`;
			buf += `<strong>To add a friend, use </strong><code>/friend add [username]</code>.<br /><br />`;
			buf += `<strong>To move over your friends to this account from a different account, `;
			buf += `sign into that account and use </strong><code>/friend requesttransfer [new name]</code>.`;
			return buf;
		}
		buf += `</h3> `;
		for (const key in friends) {
			const friendArray = friends[key].sort();
			if (friendArray.length === 0) continue;
			buf += `<h4>${STATUS_TITLES[key]} (${friendArray.length})</h4>`;
			for (const friend of friendArray) {
				buf += `<div class="pad"><div>`;
				buf += await this.displayFriend(friend);
				buf += `</div></div>`;
			}
		}

		return buf;
	}
	async displayFriend(userid: string) {
		const user = Users.getExact(userid); // we want this to be exact
		const connected = user?.connected;
		const name = Utils.escapeHTML(user ? user.name : userid);
		const statusType = connected ?
			`<strong style="color:${STATUS_COLORS[user!.statusType]}">\u25C9 ${STATUS_TITLES[user!.statusType]}</strong>` :
			'\u25CC Offline';
		let buf = connected ?
			`<span class="username"> <strong>${name}</strong></span><span><small> (${statusType})</small></span>` :
			Utils.html`<i>${name}</i> <small>(${statusType})</small>`;
		buf += `<br />`;
		const oldName = this.renames.get(userid);
		if (oldName) {
			buf += Utils.html`<small>(recently renamed from ${oldName})</small><br />`;
		}
		const curUser = Users.get(userid); // might be an alt
		if (user?.connected) {
			if (user.userMessage) buf += Utils.html`Status: <i>${user.userMessage}</i><br />`;
		} else if (curUser?.id && curUser.id !== userid) {
			buf += `<small>On an alternate account</small><br />`;
		}
		const lastLogin = await this.getLastLogin(userid);
		if (lastLogin && !connected) {
			// THIS IS A TERRIBLE HACK BUT IT WORKS OKAY
			const time = Chat.toTimestamp(new Date(Number(lastLogin)), {human: true});
			buf += `Last login: ${time.split(' ').reverse().join(', on ')}`;
			buf += ` (${Chat.toDurationString(Date.now() - lastLogin, {precision: 1})} ago)`;
		}
		buf = `<div class="infobox">${buf}</div>`;
		return toLink(buf);
	}
	addFriend(senderName: User | string, receiverName: string) {
		const receiverID = toID(receiverName);
		const senderID = toID(senderName);
		if (!receiverID) throw new Chat.ErrorMessage(`Invalid user.`);

		if (this.hasFriendship(senderID, receiverID)) {
			throw new Chat.ErrorMessage(`You and ${receiverID} are already friends.`);
		}
		const sender = Users.getExact(senderID);
		const receiver = Users.getExact(receiverID);
		if (sender) {
			if (!sender.friends) sender.friends = new Set();
			sender.friends.add(receiverID);
		}
		if (receiver?.friendRequests) {
			if (!receiver.friends) receiver.friends = new Set();
			receiver.friends.add(senderID);
		}

		return Promise.all([
			PM.query({statement: 'add', data: {userid: senderID, friend: receiverID, login: Date.now()}, type: 'run'}),
			PM.query({statement: 'add', data: {userid: receiverID, friend: senderID, login: Date.now()}, type: 'run'}),
		]);
	}
	removeFriend(userName: string, friendName: string) {
		const userid = toID(userName);
		const friendID = toID(friendName);
		if (!friendID || !userid) throw new Chat.ErrorMessage(`Invalid usernames supplied.`);

		const user = Users.getExact(userid);
		const friend = Users.getExact(friendID);
		if (user) {
			if (!user.friends) user.friends = new Set();
			if (!user.friends.has(friendID)) throw new Chat.ErrorMessage(`You do not have '${friendID}' friended.`);
			user.friends.delete(friendID);
		}
		if (friend) {
			if (!friend.friends) friend.friends = new Set();
			friend.friends.delete(userid);
		}
		return PM.query({
			statement: 'delete', type: 'run', data: {userid},
		});
	}
	sendPM(message: string, to: string, from = '&') {
		const id1 = toID(to);
		const id2 = toID(from);
		const user1 = (Users.get(id1) ? Users.get(id1) : id1) as User | string;
		const toIdentity = typeof user1 === 'object' ? user1.getIdentity() : id1;
		const user2 = (Users.get(id2) ? Users.get(id2) : id2) as User | string;
		const fromIdentity = typeof user2 === 'object' ? user2?.getIdentity() : id2;

		if (from === '&') {
			if (typeof user1 !== 'object') return; // don't need to continue, user doesn't exist and it's a ghost pm
			return user1.send(`|pm|&|${toIdentity}|${message}`);
		}
		if (typeof user1 === 'object') {
			user1.send(`|pm|${fromIdentity}|${toIdentity}|${message}`);
		}
		if (typeof user2 === 'object') {
			user2.send(`|pm|${fromIdentity}|${toIdentity}|${message}`);
		}
	}
	notifyPending(user: User) {
		if (user.settings.blockFriendRequests) return;
		const pendingCount = user.friendRequests?.received?.size;
		if (!pendingCount || pendingCount < 1) return;
		this.sendPM(`/text You have ${pendingCount} friend requests pending!`, user.id);
		this.sendPM(`/raw <button class="button" name="send" value="/j view-friends-received">View</button></div>`, user.id);
	}
	notifyConnection(user: User) {
		const message = `/nonotify Your friend ${Utils.escapeHTML(user.name)} has just connected!`;
		for (const userid of user.friends!) {
			const curUser = Users.get(userid);
			if (curUser?.settings.allowFriendNotifications) {
				curUser.send(`|pm|&|${curUser.getIdentity()}|${message}`);
			}
		}
	}
	async hasFriendship(name1: string, name2: string) {
		const userid1 = toID(name1);
		const userid2 = toID(name2);
		const user1 = Users.get(userid1);
		const user2 = Users.get(userid2);
		if (user1 || user2) {
			return user1?.friends?.has(userid2) || user2?.friends?.has(userid1);
		} // they aren't online, check the DB
		const results = await PM.query({statement: 'findFriendship', data: {user1, user2}, type: 'all'});
		return results.length > 0;
	}
	transfer(oldUser: User, newName: string) {
		const newID = toID(newName);
		const oldID = oldUser.id;
		const newUser = Users.getExact(newID);
		if (!newUser) {
			throw new Chat.ErrorMessage(`The user '${newID}' could not be found, and so could not receive the friend transfer`);
		}
		if (newUser.friendRequests) {
			const {received, sent} = newUser.friendRequests;
			if (!received) throw new Chat.ErrorMessage(`The user '${newID}' is currently blocking friend requests.`);
			if (received.size > 0 || sent.size > 0) {
				throw new Chat.ErrorMessage(`The user '${newID}' could not be found, and so could not receive the friend transfer`);
			}
		}
		if (oldUser.friends?.has(newUser.id)) oldUser.friends?.delete(newUser.id);

		for (const curUser of Users.users.values()) {
			if (curUser.friends?.has(oldUser.id)) {
				curUser.friends.delete(oldUser.id);
				curUser.friends.add(newUser.id);
			}
		}
		newUser.friends = oldUser.friends;
		oldUser.friends?.clear();

		this.renames.set(oldID, newID);
		return Promise.all([
			PM.query({statement: 'renameFriend', data: {oldID, newID}, type: 'run'}),
			PM.query({statement: 'renameUserid', data: {oldID, newID}, type: 'run'}),
			PM.query({statement: 'rename', data: [oldID, newID, Date.now()], type: 'run'}),
		]);
	}
	writeLogin(user: User) {
		if (user.settings.hideLogins) return;
		return PM.query({
			statement: 'login', type: 'run', data: [Date.now(), user.id],
		});
	}
	clearLoginData(user: User) {
		return PM.query({
			statement: 'deleteLogin', type: 'run', data: [user.id],
		});
	}
	async getLastLogin(userid: string) {
		userid = toID(userid);
		const result = await PM.query({statement: 'checkLastLogin', type: 'get', data: [userid]});
		const num = Number(result?.['last_login']);
		if (isNaN(num)) return;
		return num;
	}
	checkCanUse(context: CommandContext) {
		const user = context.user;
		if (user.locked || user.namelocked || user.semilocked || user.permalocked) {
			throw new Chat.ErrorMessage(`You are locked, and so cannot use the friends feature.`);
		}
		if (!user.autoconfirmed) {
			throw new Chat.ErrorMessage(`You must be autoconfirmed to use the friends feature.`);
		}
		return context.checkChat(); // might be some other error here
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
	for (const page of ['all', 'sent', 'received', 'settings', 'help']) {
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
		request: 'add',
		async add(target, room, user) {
			Friends.checkCanUse(this);
			target = toID(target);
			if (target.length > 18) {
				return this.errorReply(this.tr`That name is too long - choose a valid name.`);
			}
			if (!user.autoconfirmed) {
				return this.errorReply(this.tr`Only autoconfirmed users can add friends.`);
			}
			if (!target) return this.parse('/help friends');
			if (!user.friends) user.friends = new Set();
			if (user.friends.has(toID(target))) {
				return this.errorReply(`You are already friends with ${target}.`);
			}
			await Friends.request(user, target);
			this.parse(`/join view-friends-sent`);
			return this.sendReply(this.tr`You sent a friend request to '${target}'.`);
		},
		unfriend: 'remove',
		async remove(target, room, user) {
			Friends.checkCanUse(this);
			target = toID(target);
			if (!target) return this.parse('/help friends');
			await Friends.removeFriend(user.id, target);
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
			if (!user.autoconfirmed) {
				return this.errorReply(this.tr`Only autoconfirmed users can accept friend requests.`);
			}
			if (user.settings.blockFriendRequests) {
				return this.errorReply(this.tr`You are currently blocking friend requests, and so cannot accept your own.`);
			}
			if (!target) return this.parse('/help friends');
			await Friends.approveRequest(user, target);
			const targetUser = Users.get(target);
			Friends.sendPM(`You accepted a friend request from "${target}".`, user.id);
			this.parse(`/j view-friends-received`);
			if (targetUser) Friends.sendPM(`/text ${user.name} accepted your friend request!`, targetUser.id);
		},
		deny: 'reject',
		async reject(target, room, user, connection) {
			Friends.checkCanUse(this);
			target = toID(target);
			if (!target) return this.parse('/help friends');
			if (!user.friendRequests) {
				return this.errorReply(`You are currently blocking friend requests.`);
			}
			if (!user.friendRequests.received) {
				return this.errorReply(`You are currently blocking friend requests.`);
			}
			if (!user.friendRequests.received.has(target)) {
				return this.errorReply(this.tr`You have not received a friend request from '${target}'.`);
			}
			await Friends.removeRequest(user.id, target);
			this.parse(`/join view-friends-received`);
			return Friends.sendPM(this.tr`You denied a friend request from '${target}'.`, user.id);
		},
		toggle(target, room, user) {
			Friends.checkCanUse(this);
			const setting = user.settings.blockFriendRequests;
			target = target.trim();
			const requests = user.friendRequests;
			if (this.meansYes(target)) {
				if (!setting) return this.errorReply(this.tr`You already are allowing friend requests.`);
				user.settings.blockFriendRequests = false;
				user.friendRequests = {sent: requests?.sent || new Set(), received: new Set()};
				this.sendReply(this.tr`You are now allowing friend requests.`);
			} else if (this.meansNo(target)) {
				if (setting) return this.errorReply(this.tr`You already are blocking incoming friend requests.`);
				user.settings.blockFriendRequests = true;
				user.friendRequests = {sent: requests?.sent || new Set(), received: null};
				this.sendReply(this.tr`You are now blocking incoming friend requests.`);
			} else {
				if (target) this.errorReply(this.tr`Unrecognized setting.`);
				this.sendReply(
					this.tr(setting ? `You are currently blocking friend requests.` : `You are not blocking friend requests.`)
				);
			}
			this.parse(`/j view-friends-settings`);
			user.update();
		},
		requesttransfer(target, room, user) {
			target = toID(target);
			if (!target) return this.parse(`/help friends`);
			if (transferRequests.get(target)) {
				return this.errorReply(this.tr`This user already has a transfer request pending.`);
			}
			if (target === user.id) {
				return this.errorReply(`You cannot transfer your friends to yourself.`);
			}
			if (!user.friends || user.friends.size < 1) {
				return this.errorReply(this.tr`You have no friends to transfer.`);
			}
			const targetUser = Users.getExact(target);
			if (!targetUser) return this.errorReply(this.tr`User not found.`);
			if (!targetUser.autoconfirmed) {
				return this.errorReply(this.tr`You can only transfer friends to another autoconfirmed account.`);
			}
			if (targetUser.settings.blockFriendRequests) {
				return this.errorReply(this.tr`This user is blocking friend requests, and so you cannot transfer friends to them.`);
			}
			transferRequests.set(targetUser.id, user.id);
			Friends.sendPM(`/text ${user.name} wants to transfer their friends to you!`, targetUser.id);
			Friends.sendPM(
				`/raw <button class="button" name="send" value="/friends approvetransfer ${user.id}">${this.tr('Approve')}</button>`,
				targetUser.id
			);
			Friends.sendPM(
				`/raw <button class="button" name="send" value="/friends denytransfer ${user.id}">${this.tr('Deny')}</button>`,
				targetUser.id
			);
			return Friends.sendPM(this.tr`You sent a friend transfer request to '${targetUser.name}'.`, user.id);
		},
		async approvetransfer(target, room, user, connection) {
			Friends.checkCanUse(this);
			if (!user.autoconfirmed) {
				return Friends.sendPM(`/error ${this.tr`You must be autoconfirmed to use the friends feature.`}`, user.id);
			}
			if (!transferRequests.has(user.id)) {
				return Friends.sendPM(this.tr`You have no pending friend transfer request.`, user.id);
			}
			const targetUser = Users.getExact(toID(target));
			if (!targetUser) return this.errorReply(this.tr`User '${target}' not found.`);
			await Friends.transfer(targetUser, user.id);

			Friends.sendPM(`/nonotify ${user.name} ${this.tr`transferred their friends to you.`}`, targetUser.id);
			return Friends.sendPM(this.tr`You approved ${targetUser.name}'s friend transfer request!`, user.id);
		},
		denytransfer(target, room, user) {
			Friends.checkCanUse(this);
			target = toID(target);
			const requester = transferRequests.get(user.id);
			if (!requester) {
				return Friends.sendPM(`/error ${this.tr`You have no pending friend transfer request.`}`, user.id);
			}
			transferRequests.delete(user.id);
			return Friends.sendPM(`/error ${this.tr`Denied the friend transfer request from '${requester}'.`}`, user.id);
		},
		async undorequest(target, room, user) {
			Friends.checkCanUse(this);
			target = toID(target);
			const requests = user.friendRequests;
			if (!requests) {
				return Friends.sendPM(
					`/error ${this.tr`You are blocking friend requests, and so cannot undo requests, as you have none.`}`, user.id
				);
			}
			if (!requests.sent.has(target)) {
				return Friends.sendPM(`/error ${this.tr`You have not sent a request to '${target}'.`}`, user.id);
			}
			await Friends.removeRequest(target, user.id);
			this.parse(`/join view-friends-sent`);
			return Friends.sendPM(this.tr`You removed your friend request to '${target}'.`, user.id);
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
			this.parse(`/join view-friends-settings`);
			user.update();
		},
		hidelogins: 'togglelogins',
		showlogins: 'togglelogins',
		togglelogins(target, room, user, connection, cmd) {
			Friends.checkCanUse(this);
			const setting = user.settings.hideLogins;
			if (cmd.includes('hide')) {
				if (setting) return this.errorReply(this.tr`You are already hiding your logins from friends.`);
				user.settings.hideLogins = true;
				Friends.clearLoginData(user);
				this.sendReply(`You are now hiding your login times from your friends.`);
			} else if (cmd.includes('show')) {
				if (!setting) return this.errorReply(this.tr`You are already allowing friends to see your login times.`);
				user.settings.hideLogins = false;
				this.sendReply(`You are now allowing your friends to see your login times.`);
			} else {
				return this.errorReply(`Invalid setting.`);
			}
			this.parse(`/join view-friends-settings`);
			user.update();
		},
	},
	friendshelp() {
		return this.parse('/join view-friends-help');
	},
};

export const pages: PageTable = {
	async friends(args, user) {
		if (!user.named) return Rooms.RETRY_AFTER_LOGIN;
		const [type] = args;
		let buf = '<div class="pad">';
		switch (toID(type)) {
		case 'outgoing': case 'sent':
			this.title = `[Friends] Sent`;
			buf += headerButtons('sent', user);
			buf += `<hr />`;
			if (!user.friendRequests) {
				buf += `<h3>${this.tr(`You are currently blocking friend requests`)}.</h3>`;
				return buf;
			}
			const sent = user.friendRequests.sent;
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
			const received = user.friendRequests?.received;
			if (!received) {
				buf += `<h3>${this.tr(`You are currently blocking friend requests`)}.</h3>`;
				return buf;
			}
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
				`<code>/friend requesttransfer [new name]</code> - Sends a request to [new name] to transfer your friends to them.` +
					` Both users must be online at the same time.`,
				`<code>/friend approvetransfer [old name]</code> - Accepts the friend transfer request from [old name], should it exist.` +
					` Both users must be online at the same time.`,
				`<code>/friend denytransfer</code> - Denies any active friend transfer request, if it exists.`,
				`<code>/friend hidenotifications</code> OR <code>hidenotifs</code> - Opts out of receiving friend notifications.`,
				`<code>/friend viewnotifications</code> OR <code>viewnotifs</code> - Opts into view friend notifications.`,
			].join('</li><li>');
			buf += `</li></ul>`;
			break;
		case 'settings':
			this.title = `[Friends] Settings`;
			buf += headerButtons('settings', user);
			buf += `<hr /><h3>Friends Settings:</h3>`;
			const settings = user.settings;
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
			break;
		default:
			this.title = `[Friends] All Friends`;
			buf += headerButtons('all', user);
			buf += `<hr />`;
			buf += await Friends.visualizeList(user);
		}
		buf += `</div>`;
		return toLink(buf);
	},
};

export const loginfilter: LoginFilter = async user => {
	// query their friends and attach to the user object
	await Friends.getFriends(user);
	await Friends.getRequests(user);
	// notify users of pending requests
	Friends.notifyPending(user);

	// (quietly) notify their friends (that have opted in) that they are online
	Friends.notifyConnection(user);
	// write login time
	await Friends.writeLogin(user);
};

const statements: Map<string, Sqlite.Statement> = new Map();

export const PM = new QueryProcessManager<DatabaseRequest, any>(module, query => {
	const {type, statement, data} = query;
	let result;
	const cached = statements.get(statement);
	if (!cached) return null;
	try {
		switch (type) {
		case 'all':
			result = cached.all(data);
			break;
		case 'get':
			result = cached.get(data);
			break;
		case 'run':
			result = cached.run(data);
			break;
		}
	} catch (e) {
		Monitor.crashlog(e, 'A friends database process', query);
	}
	return result;
});

if (!PM.isParentProcess) {
	for (const k in ACTIONS) {
		statements.set(k, Friends.database.prepare(ACTIONS[k]));
	}
	global.Monitor = {
		crashlog(error: Error, source = 'A friends database process', details: AnyObject | null = null) {
			const repr = JSON.stringify([error.name, error.message, source, details]);
			// @ts-ignore please be silent
			process.send(`THROW\n@!!@${repr}\n${error.stack}`);
		},
	};
	global.Config = (require as any)('../config-loader').Config;
	process.on('uncaughtException', err => {
		if (Config.crashguard) {
			Monitor.crashlog(err, 'A friends child process');
		}
	});
	// eslint-disable-next-line no-eval
	Repl.start('friends', cmd => eval(cmd));
} else {
	PM.spawn(MAX_PROCESSES);
}
