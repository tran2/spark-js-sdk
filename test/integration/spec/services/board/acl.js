/**!
 *
 * Copyright (c) 2015-2016 Cisco Systems, Inc. See LICENSE file.
 */

'use strict';

var assert = require('chai').assert;
var pluck = require('lodash.pluck');
var landingparty = require('../../../lib/landingparty');
var fixtures = require('../../../lib/fixtures-v2');

describe('Services', function() {
  describe.only('ACL Test', function() {
    this.timeout(120000);

    // added a third member in order to be able to create another room.
    var party = {
      spock: true,
      mccoy: true,
      checkov: true
    };

    var board;
    var conversation;

    function ensureConversation() {
      if (!conversation) {
        console.log('creating new conversation for board ');
        return party.spock.spark.conversation.create({
          displayName: 'Test Board Conversation',
          participants: pluck(party, 'id')
        })
        .then(function(c) {
          console.log('created new conversation for board with id: ', c.id);
          conversation = c;
          return Promise.resolve(c);
        })
        .catch(function(reason) {
          console.log('Error creating new conversation for board ', reason);
          return Promise.reject(reason);
        });
      }
      else {
        return Promise.resolve(conversation);
      }
    }

    function ensureBoard() {
      // create conversation first
      return ensureConversation()
        .then(function createBoard() {
          var data = {
            properties: {
              darkTheme: false
            }
          };
          if (!board) {
            console.log('Creating new board');
            return party.spock.spark.board.persistence.createChannel(conversation, data)
              .then(function(w) {
                board = w;
                console.log('created new board: ', board);
                return w;
              });
          }
          else {
            console.log('Getting board: ', board);
            return party.spock.spark.board.persistence.getChannel(board)
              .then(function(res) {
                console.log('Got board: ', res);
                return Promise.resolve(res);
              });
          }
        })
        .catch(function(reason) {
          return Promise.reject(reason);
        });
    }


    before(function beamDown() {
      return landingparty.beamDown(party);
    });

    describe('#create a space', function() {
      it('creates a space for conversation', function() {
        return party.mccoy.spark.feature.setFeature('developer', 'files-acl-write', true)
          .then(function() {
            return ensureConversation()
              .then(function(convo) {
                return party.spock.spark.request({
                  method: 'PUT',
                  uri: convo.url + '/space'
                });
              });
          })
          .then(function() {
            party.checkov.spark.feature.setFeature('developer', 'files-acl-write', true);
            return party.spock.spark.feature.setFeature('developer', 'files-acl-write', true);
          });
      });
    });

    describe('#_uploadImage()', function() {
      var fixture = {
        png: 'sample-image-small-one.png'
      };

      before(function() {
        return fixtures.fetchFixtures(fixture);
      });

      it('uploads image to spark files', function() {
        var testScr;
        return ensureBoard()
          .then(function(board) {
            console.log('FILES ACL WRITE MCCOY', party.mccoy.spark.feature.getFeature('developer', 'files-acl-write'));
            return party.mccoy.spark.board._uploadImage(board, fixture.png);
          })
          .then(function(scr) {
            console.log('FILES ACL WRITE SPOCK', party.spock.spark.feature.getFeature('developer', 'files-acl-write'));
            testScr = scr;
            return party.spock.spark.encryption.download(scr);
          })
          .then(function(file) {
            assert(fixtures.isMatchingFile(file, fixture.png));
          })
      });
    });

  });
});
