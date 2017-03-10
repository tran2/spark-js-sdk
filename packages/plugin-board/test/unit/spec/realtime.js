/**!
 *
 * Copyright (c) 2015-2016 Cisco Systems, Inc. See LICENSE file.
 */

import {assert} from '@ciscospark/test-helper-chai';
import MockSpark from '@ciscospark/test-helper-mock-spark';
import MockSocket from '@ciscospark/test-helper-mock-socket';
import {ConnectionError, AuthorizationError} from '@ciscospark/plugin-mercury';
import sinon from '@ciscospark/test-helper-sinon';
import Board, {config} from '../..';
import uuid from 'uuid';

function delay(timeout) {
  return new Promise((resolve) => {
    setTimeout(resolve, timeout);
  });
}

describe(`plugin-board`, () => {
  describe(`realtime`, () => {
    let spark;
    const encryptedData = `encryptedData`;
    const fakeURL = `fakeURL`;
    const mockSocket = new MockSocket();

    beforeEach(() => {
      spark = new MockSpark({
        children: {
          board: Board
        },
        encryption: {
          encryptText: sinon.stub().returns(Promise.resolve(encryptedData))
        },
        config: {
          board: config.board
        }
      });

      spark.board.realtime.set({
        boardBindings: [`binding`],
        boardWebSocketUrl: fakeURL
      });
      sinon.stub(spark.board.realtime, `_getNewSocket`).returns(mockSocket);
      spark.board.realtime.socket = mockSocket;
    });

    afterEach(() => mockSocket.open.reset());

    describe(`#publish()`, () => {
      const message = {
        payload: {
          data: `fake`
        },
        envelope: {
        }
      };

      const channel = {
        defaultEncryptionKeyUrl: fakeURL
      };

      beforeEach(() => {
        sinon.stub(uuid, `v4`).returns(`stubbedUUIDv4`);
        return spark.board.realtime.publish(channel, message);
      });

      afterEach(() => {
        uuid.v4.restore();
        spark.encryption.encryptText.reset();
      });

      it(`sends encrypted data on the socket`, () => {
        assert.calledOnce(spark.encryption.encryptText);
        assert.calledWith(spark.board.realtime.socket.send, {
          id: uuid.v4(),
          type: `publishRequest`,
          recipients: [{
            alertType: `none`,
            route: `binding`,
            headers: {}
          }],
          data: {
            eventType: `board.activity`,
            payload: `encryptedData`,
            envelope: {
              encryptionKeyUrl: `fakeURL`
            },
            contentType: `STRING`
          }
        });
      });
    });

    describe(`#publishEncrypted()`, () => {

      beforeEach(() => {
        sinon.stub(uuid, `v4`).returns(`stubbedUUIDv4`);
        return spark.board.realtime.publishEncrypted({
          encryptedData: `encryptedData`,
          encryptedKeyUrl: `fakeURL`
        }, `STRING`);
      });

      afterEach(() => {
        spark.board.realtime.boardBindings = [];
        uuid.v4.restore();
        spark.encryption.encryptText.reset();
      });

      it(`sends encrypted data on the socket`, () => {
        assert.notCalled(spark.encryption.encryptText);
        assert.calledWith(spark.board.realtime.socket.send, {
          id: uuid.v4(),
          type: `publishRequest`,
          recipients: [{
            alertType: `none`,
            headers: {},
            route: `binding`
          }],
          data: {
            contentType: `STRING`,
            eventType: `board.activity`,
            envelope: {
              encryptionKeyUrl: `fakeURL`
            },
            payload: `encryptedData`
          }
        });
      });
    });

    describe(`when trying to share mercury connection`, () => {
      let replaceBindingRes;
      let removeBindingRes;
      beforeEach(() => {
        replaceBindingRes = {
          mercuryConnectionServiceClusterUrl: `https://mercury-connection-a5.wbx2.com/v1`,
          binding: `board.a85e2f70-528d-11e6-ad98-bd2acefef905`,
          webSocketUrl: `wss://mercury-connection-a.wbx2.com/v1/apps/wx2/registrations/14d6abda-16de-4e02-bf7c-6d2a0e77ec38/messages`,
          sharedWebSocket: true,
          action: `REPLACE`
        };

        removeBindingRes = {
          binding: `board.a85e2f70-528d-11e6-ad98-bd2acefef905`,
          webSocketUrl: `wss://mercury-connection-a.wbx2.com/v1/apps/wx2/registrations/14d6abda-16de-4e02-bf7c-6d2a0e77ec38/messages`,
          sharedWebSocket: false,
          action: `REMOVE`
        };


        sinon.stub(spark.board, `registerToShareMercury`).returns(Promise.resolve(replaceBindingRes));
        sinon.stub(spark.board, `unregisterFromSharedMercury`).returns(Promise.resolve(removeBindingRes));
      });

      afterEach(() => {
        spark.board.registerToShareMercury.restore();
      });

      describe(`#connectToSharedMercury`, () => {
        it(`registers and gets board binding`, () => {
          return spark.board.realtime.connectToSharedMercury()
            .then((res) => {
              assert.isTrue(spark.board.realtime.isSharingMercury);
              assert.deepEqual(res, replaceBindingRes);
            });
        });

        describe(`when connection cannot be shared`, () => {
          it(`opens a second socket with provided webSocketUrl`, () => {
            replaceBindingRes.sharedWebSocket = false;
            return spark.board.realtime.connectToSharedMercury()
              .then((res) => {
                assert.isFalse(spark.board.realtime.isSharingMercury);
                assert.deepEqual(res, replaceBindingRes);
                assert.calledWith(mockSocket.open, replaceBindingRes.webSocketUrl, sinon.match.any);
              });
          });
        });
      });

      describe(`#disconnectFromSharedMercury`, () => {
        it(`requests to remove board bindings`, () => {
          return spark.board.realtime.connectToSharedMercury()
            .then(() => {
              assert.isTrue(spark.board.realtime.isSharingMercury);
              return spark.board.realtime.disconnectFromSharedMercury();
            })
            .then((res) => {
              assert.isFalse(spark.board.realtime.isSharingMercury);
              assert.deepEqual(res, removeBindingRes);
            });
        });

        describe(`when a second connection is open`, () => {
          it(`disconnects the second socket`, () => {
            sinon.stub(spark.board.realtime, `disconnect`).returns(Promise.resolve());
            replaceBindingRes.sharedWebSocket = false;
            return spark.board.realtime.connectToSharedMercury()
              .then(() => {
                assert.isFalse(spark.board.realtime.isSharingMercury);
                return spark.board.realtime.disconnectFromSharedMercury();
              })
              .then(() => {
                assert.isFalse(spark.board.realtime.isSharingMercury);
                assert.called(spark.board.realtime.disconnect);
                spark.board.realtime.disconnect.restore();
              });
          });
        });
      });

    });

    describe(`#_boardChannelIdToMercuryBinding`, () => {
      it(`adds board. binding prefix`, () => {
        assert.equal(spark.board.realtime._boardChannelIdToMercuryBinding(`test`), `board.test`);
      });

      it(`replaces '-' with '.' and '_' with '#'`, () => {
        assert.equal(spark.board.realtime._boardChannelIdToMercuryBinding(`abc-1234_bcd`), `board.abc.1234#bcd`);
      });

      it(`leaves strings without - and _ alone`, () => {
        assert.equal(spark.board.realtime._boardChannelIdToMercuryBinding(`abcdefghijklmnopqrstuvwxyz0123456789~!@#$%^&*()+=`), `board.abcdefghijklmnopqrstuvwxyz0123456789~!@#$%^&*()+=`);
      });
    });

    describe(`#_attemptConnection()`, () => {

      before(() => {
        mockSocket.open.returns(Promise.resolve());
      });

      after(() => {
        mockSocket.open.reset();
      });

      it(`opens socket`, (done) => {
        spark.board.realtime._attemptConnection(() => {
          assert.called(mockSocket.open);
          done();
        });
      });
    });

    describe(`when buffer state event is received`, () => {
      it(`emits the event even before connect promise is resolved`, () => {
        const bufferStateMessage = {
          data: {
            eventType: `mercury.buffer_state`
          }
        };
        const bufferSpy = sinon.spy();
        const onlineSpy = sinon.spy();

        // Buffer state message is emitted after authorization
        spark.credentials.getAuthorization = () => {
          return new Promise((resolve) => {
            resolve(`Token`);
          })
            .then(() => {
              assert.notCalled(onlineSpy);
              spark.board.realtime.socket.emit(`message`, {data: bufferStateMessage});
            });
        };

        spark.board.realtime.on(`event:mercury.buffer_state`, bufferSpy);
        spark.board.realtime.on(`online`, onlineSpy);

        return assert.isFulfilled(spark.board.realtime.connect())
          .then(() => {
            assert.callCount(onlineSpy, 1);
            assert.callCount(bufferSpy, 1);
            assert.calledWith(bufferSpy, bufferStateMessage);
          });
      });
    });

    describe(`on errors`, () => {

      after(() => {
        mockSocket.open.reset();
        mockSocket.open.returns(Promise.resolve());
        spark.credentials.getAuthorization.reset();
      });

      it(`submits connection error to metric`, () => {
        spark.board.config.maxRetries = 1;
        mockSocket.open.returns(Promise.reject(new ConnectionError()));
        return assert.isRejected(spark.board.realtime.connect());
      });

      it(`rejects on AuthorizationError`, () => {
        spark.board.config.maxRetries = 1;
        spark.credentials.getAuthorization.returns(Promise.reject(new AuthorizationError()));
        return assert.isRejected(spark.board.realtime.connect());
      });
    });

    describe(`#_onmessage`, () => {
      let fakeEvent;

      beforeEach(() => {
        fakeEvent = {
          id: uuid.v4(),
          data: {
            eventType: `board.activity`,
            actor: {
              id: `actorId`
            },
            conversationId: uuid.v4()
          },
          timestamp: Date.now(),
          trackingId: `suffix_${uuid.v4()}_${Date.now()}`
        };
      });

      it(`emits message`, () => {
        const spy = sinon.spy();
        spark.board.realtime.on(`event:board.activity`, spy);

        return spark.board.realtime.connect()
          .then(() => {
            spark.board.realtime.socket.emit(`message`, {data: fakeEvent});
            return delay(0);
          })
          .then(() => {
            assert.called(spy);
          });
      });

      it(`does not emits when handler not found`, () => {
        fakeEvent.data.eventType = `unhandler`;
        const spy = sinon.spy();
        spark.board.realtime.on(`event:board.activity`, spy);

        return spark.board.realtime._onmessage({data: fakeEvent})
          .then(() => {
            assert.notCalled(spy);
          });
      });
    });
  });
});
