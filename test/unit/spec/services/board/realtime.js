/**!
 *
 * Copyright (c) 2015-2016 Cisco Systems, Inc. See LICENSE file.
 */

'use strict';

var chai = require('chai');
var Board = require('../../../../../src/client/services/board');
var MockSpark = require('../../../lib/mock-spark');
var MockSocket = require('../../../lib/mock-socket');
var Socket = require('../../../../../src/client/mercury/socket');
var delay = require('../../../../lib/delay');
var sinon = require('sinon');
var uuid = require('uuid');
var assert = chai.assert;

sinon.assert.expose(chai.assert, {prefix: ''});

describe('Services', function() {
  describe('Board', function() {
    describe('Realtime', function() {
      var encryptedData = 'encryptedData';
      var boundObject = ['bindings'];
      var fakeURL = 'fakeURL';
      var spark;
      var socketOpenStub;

      beforeEach(function() {
        spark = new MockSpark({
          children: {
            board: Board
          },
          encryption: {
            encryptText: sinon.stub().returns(Promise.resolve(encryptedData))
          }
        });

        spark.board.realtime.boardBindings = ['bindings'];
        spark.board.realtime.socket = new MockSocket();
        spark.board.realtime._getNewSocket = sinon.stub().returns(spark.board.realtime.socket);

        socketOpenStub = spark.board.realtime.socket.open;
        socketOpenStub.returns(Promise.resolve());

        sinon.spy(spark.board.realtime.metrics, 'submitConnectionFailureMetric');
      });

      describe('#publish()', function testSetBoardWebSocketUrl() {
        var message = {
          payload: {
            data: 'fake'
          },
          envelope: {
          }
        };
        var channel = {
          defaultEncryptionKeyUrl: fakeURL
        };

        var rcpnts = [{alertType:'none', headers: {}, route: boundObject[0]}];

        beforeEach(function() {
          sinon.stub(uuid, 'v4').returns('stubbedUUIDv4');
          return spark.board.realtime.publish(channel, message);
        });

        afterEach(function() {
          uuid.v4.restore();
          spark.encryption.encryptText.reset();
        });

        it('encrypts messsage', function() {
          assert.calledOnce(spark.encryption.encryptText);
        });

        it('sends encrypted data on the socket', function() {
          assert.calledWith(spark.board.realtime.socket.send, sinon.match({
            id: uuid.v4(),
            type: 'publishRequest',
            recipients: rcpnts,
            data: {
              eventType: 'board.activity',
              contentType: 'STRING',
              envelope: {
                encryptionKeyUrl: 'fakeURL'
              },
              payload: 'encryptedData'
            }
          }));
        });
      });

      describe('#publishEncrypted()', function testSetBoardWebSocketUrl() {

        beforeEach(function() {
          spark.board.realtime.boardBindings = ['binding'];
          sinon.stub(uuid, 'v4').returns('stubbedUUIDv4');
          return spark.board.realtime.publishEncrypted({
              encryptedData: 'encryptedData',
              encryptionKeyUrl: 'fakeURL'
            },
            'STRING'
          );
        });

        afterEach(function() {
          spark.board.realtime.boardBindings = [];
          uuid.v4.restore();
          spark.encryption.encryptText.reset();
        });

        it('does not encrypt', function() {
          assert.notCalled(spark.encryption.encryptText);
        });

        it('sends encrypted data on the socket', function() {
          assert.calledWith(spark.board.realtime.socket.send, sinon.match({
            id: uuid.v4(),
            type: 'publishRequest',
            recipients: [{
              alertType: 'none',
              headers: {},
              route: 'binding'
            }],
            data: {
              eventType: 'board.activity',
              contentType: 'STRING',
              envelope: {
                encryptionKeyUrl: 'fakeURL'
              },
              payload: 'encryptedData'
            }
          }));
        });
      });

      describe('when trying to share mercury connection', function() {
        var replaceBindingRes;
        var removeBindingRes;
        beforeEach(function() {
          replaceBindingRes = {
            mercuryConnectionServiceClusterUrl: 'https://mercury-connection-a5.wbx2.com/v1',
            binding: 'board.a85e2f70-528d-11e6-ad98-bd2acefef905',
            webSocketUrl: 'wss://mercury-connection-a.wbx2.com/v1/apps/wx2/registrations/14d6abda-16de-4e02-bf7c-6d2a0e77ec38/messages',
            sharedWebSocket: true,
            action: 'REPLACE'
          };

          removeBindingRes = {
            binding: 'board.a85e2f70-528d-11e6-ad98-bd2acefef905',
            webSocketUrl: 'wss://mercury-connection-a.wbx2.com/v1/apps/wx2/registrations/14d6abda-16de-4e02-bf7c-6d2a0e77ec38/messages',
            sharedWebSocket: false,
            action: 'REMOVE'
          };

          sinon.stub(spark.board.persistence, 'registerToShareMercury').returns(Promise.resolve(replaceBindingRes));
          sinon.stub(spark.board.persistence, 'unregisterFromSharedMercury').returns(Promise.resolve(removeBindingRes));
        });

        afterEach(function() {
          spark.board.persistence.registerToShareMercury.restore();
          spark.board.persistence.unregisterFromSharedMercury.restore();
        });

        describe('#connectToSharedMercury', function() {
          it('registers and gets board binding', function() {
            return spark.board.realtime.connectToSharedMercury()
              .then(function(res) {
                assert.deepEqual(res, replaceBindingRes);
                assert.notCalled(socketOpenStub);
                assert.isTrue(spark.board.realtime.isSharingMercury);
              });
          });

          describe('when connection cannot be shared', function() {
            it('opens a second socket with provided webSocketUrl', function() {
              replaceBindingRes.sharedWebSocket = false;
              return spark.board.realtime.connectToSharedMercury()
                .then(function(res) {
                  assert.deepEqual(res, replaceBindingRes);
                  assert.calledWith(socketOpenStub, replaceBindingRes.webSocketUrl, sinon.match.any);
                  assert.isFalse(spark.board.realtime.isSharingMercury);
                });
            });
          });
        });

        describe('#disconnectFromSharedMercury', function() {
          it('removes board binding', function() {
            return spark.board.realtime.connectToSharedMercury()
              .then(function() {
                return spark.board.realtime.disconnectFromSharedMercury();
              })
              .then(function(res) {
                assert.deepEqual(res, removeBindingRes);
              });
          });

          describe('when a second connection is open', function() {
            it('disconnects the socket', function() {
              sinon.stub(spark.board.realtime, 'disconnect').returns(Promise.resolve());
              replaceBindingRes.sharedWebSocket = false;
              return spark.board.realtime.connectToSharedMercury()
                .then(function() {
                  assert.isFalse(spark.board.realtime.isSharingMercury);
                  return spark.board.realtime.disconnectFromSharedMercury();
                })
                .then(function() {
                  assert.called(spark.board.realtime.disconnect);
                  spark.board.realtime.disconnect.restore();
                });
            });
          });
        });

      });


      describe('#_attemptConnection()', function() {
        it('opens socket', function() {
          return spark.board.realtime._attemptConnection()
            .then(function() {
              assert.called(socketOpenStub);
            });
        });

      });

      describe('when buffer state event is received', function() {
        it('emits the event even before connect promise is resolved', function() {
          var bufferStateMessage = {
            data: {
              eventType: 'mercury.buffer_state'
            }
          };
          var bufferSpy = sinon.spy();
          var onlineSpy = sinon.spy();

          // Buffer state message is emitted after authorization
          spark.credentials.getAuthorization = function() {
            return new Promise(function(resolve) {
              resolve('Token');
            })
              .then(function() {
                assert.notCalled(onlineSpy);
                spark.board.realtime.socket.emit('message', {data: bufferStateMessage});
              });
          };

          spark.board.realtime.on('mercury.buffer_state', bufferSpy);
          spark.board.realtime.on('online', onlineSpy);

          return assert.isFulfilled(spark.board.realtime.connect())
            .then(function() {
              assert.callCount(bufferSpy, 1);
              assert.calledWith(bufferSpy, bufferStateMessage.data);
            });
        });
      });

      describe('on errors', function() {
        it('submits connection error to metric', function() {
          spark.board.config.maxRetries = 1;
          socketOpenStub.returns(Promise.reject(new Socket.ConnectionError()));
          return assert.isRejected(spark.board.realtime.connect())
            .then(function() {
              assert.called(spark.board.realtime.metrics.submitConnectionFailureMetric);
            });
        });

        it('rejects on AuthorizationError', function() {
          spark.board.config.maxRetries = 1;
          spark.credentials.getAuthorization.returns(Promise.reject(new Socket.AuthorizationError()));
          return assert.isRejected(spark.board.realtime.connect());
        });
      });

      describe('#_onmessage', function() {
        var fakeEvent;
        beforeEach(function() {
          fakeEvent = {
            id: uuid.v4(),
            data: {
              eventType: 'board.activity',
              actor: {
                id: 'actorId'
              },
              conversationId: uuid.v4()
            },
            timestamp: Date.now(),
            trackingId: 'suffix_' + uuid.v4() + '_' + Date.now()
          };
        });

        it('emits message', function() {
          var spy = sinon.spy();
          spark.board.realtime.on('board.activity', spy);
          return spark.board.realtime.connect()
            .then(function() {
              spark.board.realtime.socket.emit('message', {data: fakeEvent});
              return delay(0);
            })
            .then(function() {
              assert.called(spy);
            });
        });

        it('emits request message if found request id', function() {
          var spy = sinon.spy();
          var spy2 = sinon.spy();
          fakeEvent.data.eventType = 'request';
          fakeEvent.data.requestId = 'requestId';
          spark.board.realtime.on('request', spy);
          spark.board.realtime.on('request:requestId', spy2);
          return spark.board.realtime.connect()
            .then(function() {
              spark.board.realtime.socket.emit('message', {data: fakeEvent});
              return delay(0);
            })
            .then(function() {
              assert.called(spy);
              assert.called(spy2);
            });
        });

        it('does not emits when handler not found', function() {
          fakeEvent.data.eventType = 'unhandler';
          var spy = sinon.spy();
          spark.board.realtime.on('board.activity', spy);
          return spark.board.realtime._onmessage({data: fakeEvent})
            .then(function() {
              assert.notCalled(spy);
            });
        });
      });
    });
  });
});
