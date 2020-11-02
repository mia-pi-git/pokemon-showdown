/**
 * Plugin to notify given rooms / the Development room on Pokemon Showdown
 * of github updates.
 * Some html / design from xfix's github bot, plugin by Mia.
 * @author mia-pi-git
 */
// @ts-ignore old enough module it has no types
import * as githubhook from 'githubhook';
import {Utils} from '../../lib/utils';
import {FS} from '../../lib/fs';

const cooldown = 15 * 60 * 1000;
const rooms: RoomID[] = Config.github?.rooms ? Config.github.rooms : ['staff', 'upperstaff', 'development'];

export const github = githubhook({
	port: (Config.github?.port || Config.port + 1),
	secret: (Config.github?.secret || ''),
	callback: '/server/chat-plugins/github.ts',
});

interface GithubData {
	names: {[k: string]: string};
	bans: string[];
	repos: {[k: string]: string};
}

export let gitData: GithubData = {
	bans: ['dependabot-preview[bot]'],
	names: {},
	repos: {
		'pokemon-showdown': 'server',
		'pokemon-showdown-client': 'client',
		'Pokemon-Showdown-Dex': 'dex',
	},
};

try {
	gitData = JSON.parse(FS('config/chat-plugins/github.json').readIfExistsSync());
} catch (e) {};

github.on('push',
	(repo: string, ref: string, result: AnyObject) => GithubParser.push(repo, ref, result)
);

github.on(
	'pull_request',
	(repo: string, ref: string, result: AnyObject) => GithubParser.pull(repo, ref, result)
);

export const GithubParser = new class {
	pushes: AnyObject;
	constructor() {
		this.pushes = {};
	}
	shouldShow(id: string, repo: string) {
		if (gitData.bans.includes(id)) return false;
		if (!this.pushes[repo]) this.pushes[repo] = {};
		if (Date.now() - this.pushes[repo][id] > cooldown) return true;
		if (Date.now() - this.pushes[repo][id] < cooldown) this.pushes[repo][id] = Date.now();
		return false;
	}
	repository(repo: string) {
		if (gitData.repos[repo]) return gitData.repos[repo];
		return repo;
	}
	save() {
		FS('config/chat-plugins/github.json').writeUpdate(() => JSON.stringify(gitData));
	}
	report(html: string) {
		Rooms.global.notifyRooms(rooms, `|c|&|/uhtml github,<div class="infobox">${html}</div>`);
	}
	push(repo: string, ref: string, result: AnyObject) {
		const url = result.compare;
		const buffer = result.commits.map((commit: AnyObject) => {
			const message = commit.message;
			const shortMessage = /.+/.exec(message)![0];
			const id = commit.id.slice(0, 6);
			const formattedRepo = `[<font color='FF00FF'>${this.repository(repo)}</font>]`;
			const userName = Utils.html`<font color='909090'>(${this.getName(result.sender.login)})</font>`;
			return `${formattedRepo} <a href="${url}"><font color='606060'>${id}</font></a> ${shortMessage} ${userName}`;
		}).join('<br/ >');
		if (!this.pushes[repo]) this.pushes[repo] = {};
		if (!this.shouldShow(result.sender.login, repo)) return;
		this.pushes[repo][result.pusher.name] = Date.now();
		this.report(buffer);
	}
	pull(repo: string, ref: string, result: AnyObject) {
		const committer = toID(result.sender.login);
		if (gitData.bans.includes(committer)) return;
		const num = result.pull_request.number;
		const url = result.pull_request.html_url;
		const title = result.pull_request.title;
		const name = this.getName(result.sender.login);
		if (!this.shouldShow(result.sender.login, repo)) return;
		let action = result.action;
		if (action === 'synchronize') {
			action = 'updated';
		}
		if (action === 'review_requested') {
			action = 'requested a review for';
		}
		const blacklisted = ['converted_to_draft', 'ready_for_review', 'converted_to_draft'];
		if (blacklisted.includes(action)) {
			return;
		}
		this.report(
			`[<font color='FF00FF'>${repo}</font>] <font color='909090'>${name}</font> ` +
			`${action} <a href="${url}">PR#${num}</a>: ${title}`
		);
	}
	getName(name: string) {
		if (gitData.names[name]) return gitData.names[name];
		return name;
	}
};

export const commands: ChatCommands = {
	git: 'github',
	gh: 'github',
	github: {
		ban(target, room, user) {
			room = this.requireRoom('development');
			this.checkCan('mute', null, room);
			if (gitData.bans.includes(target)) return this.errorReply(`${target} is already gitbanned.`);
			gitData.bans.push(target);
			GithubParser.save();
			this.privateModAction(`(${user.name} prevented ${target} from being reported by the plugin.)`);
			return this.modlog('GITBAN', null, target);
		},
		unban(target, room, user) {
			room = this.requireRoom('development');
			this.checkCan('mute', null, room);
			const index = gitData.bans.indexOf(target);
			if (index < 0) return this.errorReply(`${target} is not gitbanned.`);
			gitData.bans.splice(index, 1);
			GithubParser.save();
			this.privateModAction(`(${user.name} allowed ${target} to be reported by the plugin.)`);
			return this.modlog('UNGITBAN', null, target);
		},
		bans(target, room, user) {
			room = this.requireRoom('development');
			this.checkCan('mute', null, room);
			let buf = `<strong>IDs banned from being reported by the Github Plugin</strong>:<hr/ >`;
			for (const id of gitData.bans) {
				buf += `- ${id}<br/ >`;
			}
			return this.sendReplyBox(buf);
		},
		setname(target, room, user) {
			room = this.requireRoom('development');
			this.checkCan('mute', null, room);
			const [oldID, newName] = target.split(',');
			if (!target || !oldID || !newName) return this.errorReply(`Specify a GitHub username and new name.`);
			if (gitData.names[oldID] === newName) return this.errorReply("That Git ID is already set to that name.");
			gitData.names[oldID] = newName;
			GithubParser.save();
			this.privateModAction(`(${user.name} set ${oldID}'s name to be ${newName} in the Github Plugin.)`);
			this.modlog(`GIT NAME`, null, `"${oldID}" to "${newName}"`);
		},
		resetname(target, room, user) {
			room = this.requireRoom('development');
			this.checkCan('mute', null, room);
			if (!target) return this.errorReply(`Specify a name.`);
			if (!gitData.names[target]) return this.errorReply("That Git ID does not have a name set.");
			delete gitData.names[target];
			GithubParser.save();
			this.privateModAction(`(${user.name} reset ${target}'s name in the Github Plugin.)`);
			return this.modlog(`GIT RESETNAME`, null, `${target}`);
		},
		reponame(target, room, user) {
			room = this.requireRoom('development');
			this.checkCan('mute', null, room);
			const [oldRepo, newName] = Utils.splitFirst(target, ',');
			if (!oldRepo || !newName) return this.errorReply("Specify a repo name and a new name to display.");
			gitData.repos[oldRepo] = newName;
			GithubParser.save();
			this.privateModAction(`(${user.name} set the repo ${oldRepo}'s name in the Github Plugin to ${newName}.)`);
			return this.modlog(`GIT REPONAME`, null, `${target}`);
		},
		resetreponame(target, room, user) {
			room = this.requireRoom('development');
			this.checkCan('mute', null, room);
			if (!gitData.repos[target]) return this.errorReply(`${target} does not have a name in the Github Plugin.`);
			delete gitData.repos[target];
			GithubParser.save();
			this.privateModAction(`(${user.name} reset the repo ${target}'s name in the Github Plugin.)`);
			return this.modlog(`GIT RESETREPONAME`, null, `${target}`);
		},
	},
};

github.listen();
