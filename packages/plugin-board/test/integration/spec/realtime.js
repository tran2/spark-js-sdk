
/**!
 *
 * Copyright (c) 2015-2016 Cisco Systems, Inc. See LICENSE file.
 */

import '../..';

import {assert} from '@ciscospark/test-helper-chai';
import CiscoSpark from '@ciscospark/spark-core';
import testUsers from '@ciscospark/test-helper-test-users';
import fh from '@ciscospark/test-helper-file';
import {map} from 'lodash';
import uuid from 'uuid';

describe(`plugin-board`, () => {
  describe(`realtime`, () => {
    let board, conversation, fixture, participants;

    before(`create users`, () => testUsers.create({count: 2})
      .then((users) => {
        participants = users;

        return Promise.all(map(participants, (participant) => {
          participant.spark = new CiscoSpark({
            credentials: {
              authorization: participant.token
            }
          });
          return participant.spark.device.register();
        }));
      }));

    before(`create conversation`, () => participants[0].spark.conversation.create({
      displayName: `Test Board Conversation`,
      participants
    })
      .then((c) => {
        conversation = c;
        return conversation;
      }));

    before(`create channel (board)`, () => participants[0].spark.board.createChannel(conversation)
      .then((channel) => {
        board = channel;
        return channel;
      }));

    before(`connect to realtime channel`, () => {
      return Promise.all(map(participants, (participant) => {
        return participant.spark.board.realtime.connectByOpenNewMercuryConnection(board);
      }));
    });

    before(`load fixture image`, () => fh.fetch(`sample-image-small-one.png`)
      .then((fetchedFixture) => {
        fixture = fetchedFixture;
        return fetchedFixture;
      }));

    // disconnect realtime
    after(`disconnect realtime`, () => Promise.all(map(participants, (participant) => {

      if (participant.spark.board.realtime.connected) {
        return participant.spark.board.realtime.disconnect()
          .then(() => {
            participant.spark.board.realtime.set({boardWebSocketUrl: ``});
            participant.spark.board.realtime.set({boardBindings: []});
          });
      }
      return true;
    })));

    describe(`#config`, () => {

      it(`shares board values`, () => {
        // board values
        assert.isDefined(participants[0].spark.board.realtime.config.pingInterval);
        assert.isDefined(participants[0].spark.board.realtime.config.pongTimeout);
        assert.isDefined(participants[0].spark.board.realtime.config.forceCloseDelay);

        // mercury values not defined in board
        assert.isUndefined(participants[0].spark.board.realtime.config.backoffTimeReset);
        assert.isUndefined(participants[0].spark.board.realtime.config.backoffTimeMax);
      });
    });

    describe(`#publish()`, () => {
      describe(`string payload`, () => {
        let uniqueRealtimeData;

        before(() => {
          uniqueRealtimeData = uuid.v4();
        });

        it(`posts a message to the specified board`, (done) => {
          const data = {
            envelope: {
              channelId: board,
              roomId: conversation.id
            },
            payload: {
              msg: uniqueRealtimeData
            }
          };

          // participan 1 is going to listen for RT data and confirm that we
          // have the same data that was sent.
          participants[1].spark.board.realtime.once(`event:board.activity`, ({data}) => {
            assert.equal(data.contentType, `STRING`);
            assert.equal(data.payload.msg, uniqueRealtimeData);
            done();
          });

          // confirm that both are connected.
          assert.isTrue(participants[0].spark.board.realtime.connected, `participant 0 is connected`);
          assert.isTrue(participants[1].spark.board.realtime.connected, `participant 1 is connected`);

          // do not return promise because we want done() to be called on
          // board.activity
          participants[0].spark.board.realtime.publish(board, data);
        });
      });

      describe(`file payload`, () => {
        let testScr;

        it(`uploads file to spark files which includes loc`, () => {
          return participants[1].spark.board._uploadImage(board, fixture)
            .then((scr) => {
              assert.property(scr, `loc`);
              testScr = scr;
            });
        });

        it(`posts a file to the specified board`, (done) => {

          const data = {
            envelope: {
              channelId: board,
              roomId: conversation.id
            },
            payload: {
              displayName: `image.png`,
              type: `FILE`,
              file: {
                scr: testScr
              }
            }
          };

          // participant 1 is going to listen for RT data and confirm that we have the
          // same data that was sent.
          participants[1].spark.board.realtime.once(`event:board.activity`, ({data}) => {
            assert.equal(data.contentType, `FILE`);
            assert.equal(data.payload.file.scr.loc, testScr.loc);
            assert.equal(data.payload.displayName, `image.png`);
            done();
          });

          // confirm that both are listening.
          assert.isTrue(participants[0].spark.board.realtime.connected, `participant 0 is connected`);
          assert.isTrue(participants[1].spark.board.realtime.connected, `participant 1 is listening`);

          // do not return promise because we want done() to be called on
          // board.activity
          participants[0].spark.board.realtime.publish(board, data);
        });
      });
    });
  });
});
