/**
 * Net - abstraction layer around Node's HTTP/S request system.
 * Advantages:
 * - easier acquiring of data
 * - mass disabling of outgoing requests via Config.
 */

import * as https from 'https';
import * as http from 'http';
import * as url from 'url';
import * as Streams from './streams';

export class URIRequest {
	uri: string;
	constructor(uri: string) {
		this.uri = uri;
	}
	/**
	 * Makes a basic http/https request to the URI.
	 * Returns the response data.
	 */
	async get(): Promise<string | null> {
		if (Config.noURIRequests) return null;
		const protocol = url.parse(this.uri).protocol as string;
		const net = protocol.includes('https:') ? https : http;
		return new Promise((resolve) => {
			const req = net.get(this.uri, res => {
				void Streams.readAll(res).then(buffer => {
					resolve(buffer);
				});
			});
			req.on('error', (err) => {
				throw err;
			});
			req.end();
		});
	}
	/**
	 * Makes a http/https request to the given link and returns the status, headers, and a stream.
	 * The request data itself can be read with ReadStream#read().
	 */
	async getFullResponse(): Promise<{
		statusCode: number | undefined, statusMessage: string | undefined,
		headers: http.IncomingHttpHeaders | undefined, stream: Streams.ReadStream,
	} | null> {
		if (Config.noURIRequests) return null;
		return new Promise(resolve => {
			const protocol = url.parse(this.uri).protocol as string;
			const net = protocol.includes('https:') ? https : http;
			net.get(this.uri, response => {
				response.setEncoding('utf-8');
				const stream = new Streams.ReadStream({nodeStream: response});
				resolve({
					statusCode: response.statusCode,
					statusMessage: response.statusMessage,
					headers: response.headers,
					stream: stream,
				});
			});
		});
	}
}

export function Net(uri: string) {
	return new URIRequest(uri);
}
