/**
 * 简化版 Pomelo 客户端
 * 基于 WebSocket 实现
 */
(function() {
  'use strict';

  var pomelo = {};
  var socket = null;
  var callbacks = {};
  var handlers = {};
  var reqId = 0;

  pomelo.init = function(params, cb) {
    var host = params.host || 'localhost';
    var port = params.port || 3014;
    var url = 'ws://' + host + ':' + port;
    
    socket = new WebSocket(url);
    
    socket.onopen = function() {
      console.log('WebSocket 连接成功');
      if (cb) cb();
    };
    
    socket.onmessage = function(event) {
      var msg = JSON.parse(event.data);
      
      if (msg.id && callbacks[msg.id]) {
        callbacks[msg.id](msg.body);
        delete callbacks[msg.id];
      } else if (msg.route && handlers[msg.route]) {
        handlers[msg.route](msg.body);
      }
    };
    
    socket.onclose = function() {
      console.log('WebSocket 连接关闭');
      pomelo.emit('disconnect');
    };
    
    socket.onerror = function(error) {
      console.error('WebSocket 错误:', error);
      pomelo.emit('io-error', error);
    };
  };

  pomelo.request = function(route, msg, cb) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      if (cb) cb({ code: 500, error: '连接未建立' });
      return;
    }
    
    var id = ++reqId;
    callbacks[id] = cb;
    
    var packet = {
      id: id,
      route: route,
      body: msg
    };
    
    socket.send(JSON.stringify(packet));
  };

  pomelo.on = function(route, handler) {
    handlers[route] = handler;
  };

  pomelo.emit = function(route, data) {
    if (handlers[route]) {
      handlers[route](data);
    }
  };

  pomelo.disconnect = function() {
    if (socket) {
      socket.close();
      socket = null;
    }
  };

  // 导出到全局
  window.pomelo = pomelo;
})();
