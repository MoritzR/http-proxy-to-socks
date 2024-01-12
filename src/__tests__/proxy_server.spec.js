import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockAgent = {};

const mockOn = vi.fn();

vi.mock('http', () => ({
  request: vi.fn(() => ({
    on: mockOn,
  })),
  Server: vi.fn(function Server() {
    this.addListener = vi.fn();
  }),
}));

vi.mock('https', () => ({
  request: vi.fn(() => ({
    on: mockOn,
  })),
  Server: vi.fn(function Server() {
    this.addListener = vi.fn();
  }),
}));

vi.mock('socks', () => ({
  createConnection: vi.fn(),
  Agent: vi.fn(() => mockAgent),
}));

vi.mock('socks-proxy-agent', () => ({default: vi.fn(() => mockAgent) }));

function last(array) {
  return array[array.length - 1];
}

function getLastMockOn(event) {
  return last(mockOn.mock.calls.filter(args => args[0] === event));
}

import { request as _request, Server as _Server } from 'http';
import { request as __request } from 'https';
import { createConnection as _createConnection } from 'socks';
import SocksProxyAgent from 'socks-proxy-agent';
import { createServer, getProxyObject, parseProxyLine, requestListener, connectListener, getProxyInfo } from '../proxy_server';

describe('proxy_server', () => {
  const requestURL = 'https://google.com';
  let proxyList;
  let request;
  let socksRequest;
  let response;
  let socketRequest;
  let socket;

  beforeEach(() => {
    proxyList = [{
      socksProxy: {
        host: '127.0.0.1',
        port: 8080,
      },
      whitelist: [
        new RegExp('google\\.com'),
        new RegExp('\\.org$')
      ]
    },
    {
      socksProxy: {
        host: '127.0.0.1',
        port: 8081,
      },
      blacklist: [
        new RegExp('^github\\.com$')
      ]
    }
    ];

    request = {
      on: vi.fn(),
      pipe: vi.fn(),
      url: requestURL,
    };

    socksRequest = {
      on: vi.fn(),
      pipe: vi.fn(),
      url: requestURL.slice('https://'.length),
    };

    response = {
      on: vi.fn(),
      writeHead: vi.fn(),
      end: vi.fn(),
    };

    socketRequest = {
      on: vi.fn(),
      write: vi.fn(),
      pipe: vi.fn(),
    };

    socket = {
      on: vi.fn(),
      pipe: vi.fn(),
      write: vi.fn(),
      resume: vi.fn(),
    };
  });

  describe('getProxyObject', () => {
    it('should return an object with "host", "port", "user", "pass" properties', () => {
      const host = '127.0.0.1';
      const port = '8080';
      const res = getProxyObject(host, port);

      expect(typeof res).toBe('object');
      expect(res.host).toBe(host);
      expect(res.port).toBe(parseInt(port, 10));
      expect(res.user).toBeFalsy();
      expect(res.pass).toBeFalsy();
    });
  });

  describe('parseProxyLine', () => {
    it('should return a object with "host" and "port" extracted from proxy string', () => {
      const proxyLine = '127.0.0.1:1080';
      const res = parseProxyLine(proxyLine);

      expect(typeof res).toBe('object');
      expect(res.host).toBe('127.0.0.1');
      expect(res.port).toBe(1080);
    });

    it('should also contain "username" and "password" properties when it contains these info', () => {
      const proxyLine = '127.0.0.1:1080:oyyd:password';
      const res = parseProxyLine(proxyLine);

      expect(typeof res).toBe('object');
      expect(res.host).toBe('127.0.0.1');
      expect(res.port).toBe(1080);
      expect(res.user).toBe('oyyd');
      expect(res.pass).toBe('password');
    });

    it('should throw error when the proxy string seems not good', () => {
      let proxyLine = '127.0.0.1';
      let error = null;

      try {
        error = parseProxyLine(proxyLine);
      } catch(err) {
        error = err;
      }

      expect(error instanceof Error).toBeTruthy();

      proxyLine = '127.0.0.1:8080:oyyd';
      error = null;

      try {
        error = parseProxyLine(proxyLine);
      } catch(err) {
        error = err;
      }

      expect(error instanceof Error).toBeTruthy();
    });
  });

  describe('requestListener', () => {

    it('should create an socks agent and take it as request agent (http)', () => {
      requestListener(proxyList, { ...request, url: requestURL.replace(/https/g, 'http') }, response);

      const lastCall = last(SocksProxyAgent.mock.calls);
      const httpLastCall = last(_request.mock.calls);

      expect(lastCall[0].host).toBe(proxyList[0].socksProxy.host);
      expect(httpLastCall[0].agent === mockAgent).toBeTruthy();
    });

    it('should create an socks agent and take it as request agent (https)', () => {
      requestListener(proxyList, request, response);

      const lastCall = last(SocksProxyAgent.mock.calls);
      const httpLastCall = last(__request.mock.calls);

      expect(lastCall[0].host).toBe(proxyList[0].socksProxy.host);
      expect(httpLastCall[0].agent === mockAgent).toBeTruthy();
    });

    it('should return 500 when error thrown', () => {
      requestListener(proxyList, request, response);

      const onErrorArgs = getLastMockOn('error');

      expect(onErrorArgs).toBeTruthy();

      const error = new Error('500');

      onErrorArgs[1](error);

      expect(response.writeHead.mock.calls[0][0]).toBe(500);
      expect(response.end.mock.calls[0][0].indexOf('error') > -1).toBeTruthy();
    });

    it('should pipe response when "response"', () => {
      const proxyResponse = {
        statusCode: 200,
        headers: {},
        pipe: vi.fn(),
      };

      requestListener(proxyList, request, response);

      const onResponseArgs = getLastMockOn('response');

      expect(onResponseArgs).toBeTruthy();

      onResponseArgs[1](proxyResponse);

      expect(proxyResponse.pipe.mock.calls[0][0]).toBe(response);
    });
  });

  describe('connectListener', () => {
    it('should create socks connections', () => {
      const head = '';
      connectListener(proxyList, socksRequest, socketRequest, head);

      const lastCreateConnectionCall = last(_createConnection.mock.calls);

      expect(lastCreateConnectionCall[0].target.host).toBe('google.com');
    });

    it('should write 500 when error thrown', () => {
      const head = '';
      connectListener(proxyList, socksRequest, socketRequest, head);

      const lastCreateConnectionCall = last(_createConnection.mock.calls);

      const error = new Error('500');

      lastCreateConnectionCall[1](error, socket);

      expect(socketRequest.write.mock.calls[0][0].indexOf('500') > -1).toBeTruthy();
      expect(socket.pipe.mock.calls.length === 0).toBeTruthy();
    });

    it('should pipe sockets when socket connected', () => {
      const head = '';

      connectListener(proxyList, socksRequest, socketRequest, head);

      const lastCreateConnectionCall = last(_createConnection.mock.calls);

      lastCreateConnectionCall[1](null, socket);

      expect(socketRequest.pipe.mock.calls[0][0]).toBe(socket);
      expect(socket.pipe.mock.calls[0][0]).toBe(socketRequest);
      expect(socketRequest.write.mock.calls[0][0].indexOf('200') > -1).toBeTruthy();
      expect(socket.write.mock.calls[0][0]).toBe(head);
    });
  });

  describe('createServer', () => {
    it('should push this.proxyList', () => {
      const options = {
        proxies: [{
          socks: '127.0.0.1:1080'
        }]
      };

      createServer(options);

      const { proxyList } = _Server.mock.instances[0];

      expect(proxyList[0].socksProxy.host).toBe('127.0.0.1');
      expect(proxyList[0].socksProxy.port).toBe(1080);
    });

    it('should listen both "request" and "connect" events', () => {
      const options = {
        proxy: '127.0.0.1:1080',
      };

      createServer(options);

      const { addListener } = _Server.mock.instances[0];

      const onRequestArgs = addListener.mock.calls.filter(args => args[0] === 'request');
      const onConnectArgs = addListener.mock.calls.filter(args => args[0] === 'connect');

      expect(onRequestArgs.length > 0).toBeTruthy();
      expect(onConnectArgs.length > 0).toBeTruthy();
    });
  });

  describe('getProxyInfo', () => {
    it('should select socks proxy by whitelist', () => {

      let result = getProxyInfo(proxyList, new URL('http://google.com'));

      expect(result.host).toBe('127.0.0.1');
      expect(result.port).toBe(8080);
    });

    it('should select socks proxy by avoiding blacklist', () => {

      let result = getProxyInfo(proxyList, new URL('http://google.de'));

      expect(result.host).toBe('127.0.0.1');
      expect(result.port).toBe(8081);
    });

    it('should return empty if no proxy matches', () => {

      let result = getProxyInfo(proxyList, new URL('http://github.com'));

      expect(result).toBe(undefined);
    });
  });
});
