// inspired by https://github.com/asluchevskiy/http-to-socks-proxy
import { inherits } from 'util';
import { Server, request as _request } from 'http';
import { request as __request } from 'https';
import { Socket } from 'net';
import { createConnection } from 'socks';
import SocksProxyAgent from 'socks-proxy-agent';
import { logger } from './logger';

// object class definition

function ProxyServer(options) {
  // TODO: start point
  Server.call(this, () => { });

  this.proxyList = [];

  if(options.proxies) {
    // stand alone proxy loging
    this.proxyList = options.proxies.map(proxy => {
      let socksProxy = parseProxyLine(proxy.socks);
      let whitelist = proxy.whitelist ? proxy.whitelist.map(regex => new RegExp(regex)) : undefined;
      let blacklist = !whitelist && proxy.blacklist ? proxy.blacklist.map(regex => new RegExp(regex)) : undefined;

      return { socksProxy, whitelist, blacklist };
    });
  }

  this.addListener(
    'request',
    requestListener.bind(null, this.proxyList)
  );
  this.addListener(
    'connect',
    connectListener.bind(null, this.proxyList)
  );
}

inherits(ProxyServer, Server);

// listeners

/**
 * called on HTTP targets
 */
export function requestListener(proxyList, request, response) {
  logger.info(`request: ${request.url}`);

  const target = new URL(request.url);
  const proxy = getProxyInfo(proxyList, target);

  if(proxy) {
    onSocksRequest(target, request, response, proxy);
  }
  else {
    onNoProxyRequest(target, request, response);
  }
}

/**
 * called on HTTPs targets
 */
export function connectListener(proxyList, request, socketRequest, head) {
  logger.info(`connect: ${request.url}`);

  const target = new URL(`http://${request.url}`); // connect listeners don't have the protocol in the url
  const proxy = getProxyInfo(proxyList, target);

  if(proxy) {
    onSocksConnect(target, request, socketRequest, head, proxy);
  }
  else {
    onNoProxyConnect(target, request, socketRequest, head);
  }
}

// forwarding

function onSocksRequest(target, req, res, proxy) {
  const socksAgent = new SocksProxyAgent({
    host: proxy.host,
    port: proxy.port,
    userId: proxy.user,
    password: proxy.pass
  });
  logger.info(`forwarding SOCKS HTTP(s) request for ${target} to ${proxy.host}:${proxy.port}`);
  sendProxyRequest(target, req, res, socksAgent);
}

function onSocksConnect(target, request, socketRequest, head, proxy) {
  const options = {
    proxy: {
      ipaddress: proxy.host,
      port: proxy.port,
      type: 5,
      authentication: { username: proxy.user || '', password: proxy.pass || '' },
    },
    target: { host: target.hostname, port: getPortFromUrl(target) },
    command: 'connect',
  };

  logger.info(`forwarding SOCKS HTTP(s) connect for ${target} to ${proxy.host}:${proxy.port}`);

  let socket;

  socketRequest.on('error', (err) => {
    logger.error(`${err.message}`);
    if(socket) {
      socket.destroy(err);
    }
  });

  createConnection(options, (error, _socket) => {
    socket = _socket;

    if(error) {
      // error in SocksSocket creation
      logger.error(`${error.message} connection creating on ${proxy.host}:${proxy.port}`);
      socketRequest.write(`HTTP/${request.httpVersion} 500 Connection error\r\n\r\n`);
      return;
    }

    socket.on('error', (err) => {
      logger.error(`${err.message}`);
      socketRequest.destroy(err);
    });

    // tunneling to the host
    socket.pipe(socketRequest);
    socketRequest.pipe(socket);

    socket.write(head);
    socketRequest.write(`HTTP/${request.httpVersion} 200 Connection established\r\n\r\n`);
    socket.resume();
  });
}

function onNoProxyRequest(target, req, res) {
  logger.info(`forwarding HTTP for ${target} without tunneling`);
  sendProxyRequest(target, req, res);
}

function onNoProxyConnect(target, req, socketRequest, head) {
  // Connect to an origin server
  logger.info(`forwarding HTTPS for ${target} without tunneling`);
  const socket = new Socket();

  socketRequest.on('error', (err) => {
    logger.error(`Error on request socket: ${err.message}`);
    if(socket) {
      socket.destroy(err);
    }
  });

  socket.on('error', (err) => {
    logger.error(`Error on target socket: ${err.message}`);
    socketRequest.destroy(err);
  });

  socket.connect(getPortFromUrl(target), target.hostname, () => {

    // tunneling to the host
    socket.pipe(socketRequest);
    socketRequest.pipe(socket);

    socket.write(head);
    socketRequest.write('HTTP/1.1 200 Connection Established\r\n' +
      'Proxy-agent: Node.js-Proxy\r\n' +
      '\r\n');
  });
}

function sendProxyRequest(uri, request, response, agent) {
  const options = {
    hostname: uri.hostname,
    port: getPortFromUrl(uri),
    path: `${uri.pathname}?${uri.searchParams}`,
    method: request.method,
    headers: request.headers,
    agent,
  };

  const proxyRequest = uri.protocol === 'http:' ? _request(options) : __request(options);

  request.on('error', (err) => {
    logger.error(`${err.message}`);
    proxyRequest.destroy(err);
  });

  proxyRequest.on('error', (error) => {
    logger.error(`${error.message} on connection to ${uri.hostname}:${getPortFromUrl(uri)}`);
    response.writeHead(500);
    response.end('Connection error\n');
  });

  proxyRequest.on('response', (proxyResponse) => {
    proxyResponse.pipe(response);
    response.writeHead(proxyResponse.statusCode, proxyResponse.headers);
  });

  request.pipe(proxyRequest);
}

// helpers

function getPortFromUrl(uri) {
  return uri.port || (uri.protocol === 'http:' ? 80 : 443);
}

export function getProxyInfo(proxyList, target) {
  let proxyEntry = proxyList
    .find(el =>
      (!el.whitelist || regexListMatchesString(el.whitelist, target.hostname)) &&
      (!el.blacklist || !regexListMatchesString(el.blacklist, target.hostname)));

  return proxyEntry ? proxyEntry.socksProxy : undefined;

}

function regexListMatchesString(list, string) {
  return !!list.find(regEx => regEx.test(string));
}

export function getProxyObject(host, port, login, password) {
  return {
    host,
    port: parseInt(port, 10),
    user: login,
    pass: password
  };
}

export function parseProxyLine(line) {

  const credentials = line.indexOf('@') > 0 ? line.substring(0, line.indexOf('@')).split(':') : [];
  const proxyInfo = line.substring(line.indexOf('@') + 1).split(':');

  if(proxyInfo.length !== 4 && proxyInfo.length !== 2) {
    throw new Error(`Incorrect proxy line: ${line}`);
  }

  return getProxyObject.apply(this, [...proxyInfo, ...credentials]);
}

// exports

export const createServer = options => new ProxyServer(options);
