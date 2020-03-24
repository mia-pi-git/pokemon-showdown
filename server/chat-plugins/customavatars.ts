/** Original plugin from https://github.com/CreaturePhil/Showdown-Boilerplate/blob/master/chat-plugins/customavatar.js.
Credits to CreaturePhil and the other listed contributors.
updated for side-server use by Mia-pi. */


import {FS} from '../../lib/fs';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

const AVATAR_PATH = 'config/avatars/';

function downloadImage(image_url: string, name: string) {
	return new Promise((resolve, reject) => {
		https.get(image_url, function (response: any) {
			if (response.statusCode !== 200) return reject();
			const type = response.headers['content-type'].split('/');
			if (type[0] !== 'image') return reject();
			// weird bug with PS's FS() that doesn't like this, so normal fs is required.
			const stream = fs.createWriteStream(`${AVATAR_PATH}${name}.png`);
			response.pipe(stream);
			stream.on('finish', () => {
				resolve(`${AVATAR_PATH}${name}.png`);
			});
		});
	});
}

function loadCustomAvatars() {
	const avatars: string[] = [];
	try {
		const files = FS(AVATAR_PATH).readdirSync();
		// passing over non-avatar files
		for (const file of files) {
			if (!file.endsWith('.png')) {
				continue;
			} else {
				avatars.push(file);
			}
		}
	} catch (e) {
		throw new Error(e);
	}
	for (const file of avatars) {
		const name = path.basename(file, path.extname(file));
		Config.customavatars[name] = file;
	}
}

loadCustomAvatars();

export const commands: ChatCommands = {
	customavatar: {
		add(target, room, user, connection) {
			if (!user.hasConsoleAccess(connection)) return false;
			const parts = target.split(',').map(param => param.trim());
			if (parts.length < 2) return this.parse('/help customavatar');

			const name = toID(parts[0]);
			const targetUser = Users.get(name);
			let avatarUrl = parts[1];
			if (!/^https?:\/\//i.test(avatarUrl)) avatarUrl = 'http://' + avatarUrl;
			const ext = path.extname(avatarUrl);

			if (!'.png'.includes(ext)) {
				return this.errorReply("Image url must be a .png extension.");
			}
			if (!avatarUrl.includes('https:') || avatarUrl.includes('http://')) {
				return this.errorReply("Image url must be https.");
			}

			Config.customavatars[name] = name + ext;

			try {
				void downloadImage(avatarUrl, name);
			} catch (e) {
				this.errorReply(`Error in downloading image: ${e}`);
			}
			this.sendReply(`|raw|${name}${name.endsWith('s') ? "'" : "'s"} avatar was successfully set. Avatar:<br /><img src="${avatarUrl}" width="80" height="80">`);
			this.modlog('CUSTOMAVATAR SET', targetUser);
			if (targetUser) {
				 targetUser.popup(
					 Chat.html`|html|Upper staff have set your custom avatar.<br /><img src='${avatarUrl}' width='80' height='80'><br /> Refresh your page if you don't see it.`
				);
			}
		},

		remove(target, room, user, connection) {
			if (!user.hasConsoleAccess(connection)) return false;
			const userid = toID(target);
			const targetUser = Users.get(target);
			const image = Config.customavatars[userid];

			if (!image) return this.errorReply(target + " does not have a custom avatar.");

			if (FS(AVATAR_PATH + image).existsSync()) {
				delete Config.customavatars[userid];
				void FS(AVATAR_PATH + image).unlinkIfExists();
				if (targetUser) targetUser.popup("Upper staff have removed your custom avatar.");
				this.sendReply(target + "'s avatar has been successfully removed.");
				this.modlog('CUSTOMAVATAR REMOVE', targetUser);
			} else {
				this.errorReply("That custom avatar file does not exist - try again?");
			}
		},

		customavatarhelp: 'help',
		'': 'help',
		help(target, room, user) {
			this.parse('/help customavatar');
		},
	},

	customavatarhelp: [
		"Commands for /customavatar are:",
		"/customavatar add [username], [image link] - Set a user's custom avatar. Requires: & ~",
		"/customavatar remove [username] - Delete a user's custom avatar. Requires: & ~",
	],
};
