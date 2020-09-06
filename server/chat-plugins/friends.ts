/**
 * Friends list plugin.
 * Allows for adding and removing friends, as well as seeing their activity.
 * Written by Mia-pi.
 */
import * as Sqlite from 'better-sqlite3';

export const Friends = new class {
	database: Sqlite.Database;
	constructor() {
		this.database = new Sqlite(`${__dirname}/../../databases/friends.db`);
	}
	getFriends(user: User): Set<string> {
		const results = this.database.prepare(`SELECT * FROM friends WHERE userid = ?`).all(user.id).map(item => item.friend);
		const friends = new Set(results);
		user.friends = friends;
		return friends;
	}
	request(user: User, receiverID: string) {
		receiverID = toID(receiverID);
		if (!receiverID) throw new Chat.ErrorMessage(`Invalid name.`);
		const sentRequests = user.friendRequests.sent;
		if (sentRequests.has(receiverID)) throw new Chat.ErrorMessage(`You have already sent a friend request to '${receiverID}'.`);
		if (sentRequests.size > 3) {
			throw new Chat.ErrorMessage(`You already have 3 pending friend requests.`);
		}
		const title = `${user.name} sent you a friend request!`;
		const buf = `/raw <button class="button" name="send" value="/friends approve ${user.id}">${title}</button></div>`;
		const receiver = Users.get(receiverID);

		if (receiver) {
			if (receiver.friendRequests.sent.has(user.id)) {
				return this.approveRequest(receiver, user.id);
			}
			const prefix = `|pm|${user.getIdentity()}|${receiver.getIdentity()}|`;
			receiver.send(`${prefix}${buf}`);
			user.send(`${prefix}/text You sent a friend request to ${receiver.name}!`);
			receiver.friendRequests.received.add(user.id);
		} else {
			Chat.PrivateMessages.sendOffline(buf, user, toID(receiverID));
			user.send(`|pm|${user.getIdentity()}| ${receiverID}|/text You sent a friend request to ${receiverID}!`);
		}
		this.database.prepare(`INSERT INTO friend_requests(sender, receiver) VALUES(?, ?)`).run(user.id, receiverID);
		return sentRequests.add(receiverID);
	}
	removeRequest(receiverID: string, senderID: string) {
		senderID = toID(senderID);
		receiverID = toID(receiverID);
		const sender = Users.get(senderID);
		const receiver = Users.get(receiverID);

		if (!senderID) throw new Chat.ErrorMessage(`Invalid sender username.`);
		if (!receiverID) throw new Chat.ErrorMessage(`Invalid receiver username.`);

		if (sender) {
			const {sent} = sender.friendRequests;
			if (!sent.has(receiverID)) throw new Chat.ErrorMessage(`You have not sent a friend request to '${receiverID}'.`);
			sent.delete(receiverID);
		}
		if (receiver) {
			const {received} = receiver.friendRequests;
			if (!received.has(senderID)) throw new Chat.ErrorMessage(`You have not received a friend request from '${senderID}'.`);
			received.delete(senderID);
		}
		this.database.prepare(`DELETE FROM friend_requests WHERE sender = ? AND receiver = ?`).run(receiverID, senderID);
	}
	approveRequest(receiver: User, senderID: string) {
		this.removeRequest(receiver.id, senderID);
		this.addFriend(senderID, receiver.id);
	}
	visualizeList(user: User) {
		let buf = `<h2>Your friends:</h2>`;
		for (const friend of user.friends) {
			buf += this.displayFriend(friend, user);
		}
		return buf;
	}
	displayFriend(userid: string, requester: User) {
		const user = Users.get(userid);
		let buf = `<strong><div class="username">${user ? user.name : userid}</div></strong>`;
		buf += `${user ? `Online` : '<small>Offline</small>'}<hr />`;
		if (user?.connected) {
			if (user.userMessage) buf += `("${user.userMessage}")<br />`;
			const rooms = [...user.inRooms].map(Rooms.get).filter(room => {
				return room && (requester.inRooms.has(room.roomid) || room.settings.isPrivate && requester.isStaff);
			});
			if (rooms.length) {
				buf += `<strong>Rooms:</strong><br />`;
				buf += rooms.map(room => `<a roomid="${room!.roomid}">${room!.title}</a>`).join(', ');
				buf += `<br />`;
			} else {
				buf += `(No public rooms)<br />`;
			}
			const viewableGames = [...user.games].map(Rooms.get).filter(room => {
				return rooms.includes(room) && room;
			});
			if (viewableGames.length) {
				buf += `<strong>Games:</strong><br />`;
				for (const room of viewableGames) {
					buf += `<a roomid="${room!.roomid}">${room!.title}</a>: ${room!.game!.title}<br />`;
				}
				buf += `<br />`;
			}
		}
		buf = `<div class="infobox">${buf}</div>`;
		return this.toLink(buf);
	}
	toLink(buf: string) {
		return buf.replace(/<a roomid="/g, `<a target="replace" href="/`);
	}
	addFriend(senderID: User | string, receiverID: string) {
		receiverID = toID(receiverID);
		senderID = toID(senderID);
		if (!receiverID) throw new Chat.ErrorMessage(`Invalid user.`);

		const sender = Users.get(senderID);
		const receiver = Users.get(receiverID);
		if (sender) {
			sender.friends.add(receiverID);
			if (!sender.friendRequests.sent.delete(receiverID)) {
				throw new Chat.ErrorMessage(`You have not sent a friend request to '${receiverID}'.`);
			}
		}
		if (receiver) {
			receiver.friends.add(senderID);
			receiver.friendRequests.received.delete(senderID);
		}

		const statement = this.database.prepare(`INSERT INTO friends (userid, friend) VALUES(?, ?)`);
		statement.run(senderID, receiverID);
		statement.run(receiverID, senderID);
	}
	removeFriend(userid: string, friendID: string) {
		userid = toID(userid);
		friendID = toID(friendID);
		if (!friendID || !userid) throw new Chat.ErrorMessage(`Invalid usernames supplied.`);

		const user = Users.get(userid);
		const friend = Users.get(friendID);
		if (user) {
			if (!user.friends.has(friendID)) throw new Chat.ErrorMessage(`You do not have '${friendID}' friended.`);
			user.friends.delete(friendID);
		}
		if (friend) friend.friends.delete(userid);

		const statement = this.database.prepare(`DELETE FROM friends WHERE userid = ? AND friend = ?`);
		statement.run(userid, friendID);
		statement.run(friendID, userid);
	}
}

export const commands: ChatCommands = {
	friends: {
		add(target, room, user) {

		},
		remove(target, room, user) {

		},
		list() {
			return this.parse(`/join view-friends`);
		},
		accept(target, room, user) {

		},
		reject(target, room, user) {

		},
		ban(target, room, user) {

		},
	},
}

export const pages: PageTable = {
	friends(args, user) {
		const [type] = args;
		let buf = '<div class="pad">';
		switch (toID(type)) {
		case 'outgoing': case 'sent':
			buf += `<strong>Sent</a> / <a roomid="view-friends-incoming">Received</a> / <a roomid="view-friends">All</a>`;
			if (!user.friendRequests.sent.size) {
				buf += `<h2>No outgoing requests.</h2>`;
				buf += `</div>`;
				return Friends.toLink(buf);
			}
			buf += ``;
			break;
		case 'received': case 'incoming':
			buf += `<a roomid="view-friends-outgoing">Sent</a> / <strong>Received</strong> / <a roomid="view-friends">All</a>`;
			if (!user.friendRequests.received.size) {
				buf += `<h2>None pending.</h2>`;
				buf += `</div>`;
				return Friends.toLink(buf);
			}
			for (const request of user.friendRequests.received) {
				buf += `<div class="infobox">`;
				buf += `<strong>${request}</strong>`;
				buf += ` <button class="button" name="send" value="/friends approve ${request}">Accept</button>`;
				buf += ` <button class="button" name="send" value="/friends deny ${request}">Deny</button>`;
				buf += `</div>`;
			}
			break;
		default:
			buf += `<a roomid="view-friends-outgoing">Sent</a> / <a roomid="view-friends-incoming">Received</a> / <strong>All</strong>`;
			buf += `<hr />`;
			buf += Friends.visualizeList(user);
		}
		buf += `</div>`;
		return Friends.toLink(buf);
	},
}
