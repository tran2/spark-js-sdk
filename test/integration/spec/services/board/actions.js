/**!
 *
 * Copyright (c) 2015-2016 Cisco Systems, Inc. See LICENSE file.
 */

'use strict';

var find = require('lodash.find');
var assert = require('chai').assert;
var uuid = require('uuid');
var pluck = require('lodash.pluck');
var map = require('lodash.map');
var landingparty = require('../../../lib/landingparty');
var fixtures = require('../../../lib/fixtures-v2');

function generateTonsOfContents(numOfContents) {
  var contents = [];
  for (var i = 0; i < numOfContents; i++) {
    contents.push({
      type: 'curve',
      payload: JSON.stringify({id: i, type: 'curve'})
    });
  }

  return contents;
}

describe('Services', function() {
  describe('Board', function() {
    this.timeout(0);

    // added a third member in order to be able to create another room.
    var party = {
      spock: true,
      mccoy: true,
      checkov: true
    };

    var board;
    var conversation;
    var mercuryBindingsPrefix = 'board.';

    function ensureBoardMercury() {
      // register with mercury binding and connect to mercury socket for users spark and mccoy
      console.log('connecting to board mercury');
      var mercuryBindingId = boardChannelToMercuryBinding(board.channelId);
      var bindingStr = [mercuryBindingsPrefix + mercuryBindingId];

      var bindingObj =  {
        bindings: bindingStr
      };

      return Promise.all(map(party, function(shouldCreateClient, name) {
        return party[name].spark.board.persistence.register(bindingObj)
          .then(function setWebSocketUrl(url) {
            if (url.webSocketUrl) {
              party[name].spark.board.realtime.set({boardWebSocketUrl: url.webSocketUrl});
              party[name].spark.board.realtime.set({boardBindings: bindingStr});
              return Promise.resolve(party[name].spark.board.realtime.listening ||
                  party[name].spark.board.realtime.listen())
                .then(function() {
                  console.log('finished connecting mercury for user: ', name);
                });
            }
          });
      }));
    }

    function ensureConversation() {
      if (!conversation) {
        console.log('creating new conversation for board ');
        return party.spock.spark.conversation.create({
          displayName: 'Test Board Conversation',
          participants: pluck(party, 'id')
        })
        .then(function(c) {
          console.log('created new conversation for board with id: ', c.id, c.aclUrl);
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
                return ensureBoardMercury()
                  .then(function() {
                    console.log('board mercury setup completed');
                    return Promise.resolve(w);
                  });
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

    function boardChannelToMercuryBinding(channelId) {
      // make channelId mercury compatible replace '-' with '.' and '_' with '#'
      return channelId.replace(/-/g, '.').replace(/_/g, '#');
    }

    before(function beamDown() {
      return landingparty.beamDown(party)
        .then(function() {
          party.spock.spark.feature.setFeature('developer', 'files-acl-write', true);
          party.mccoy.spark.feature.setFeature('developer', 'files-acl-write', true);
        });
    });

    describe('#_uploadImage()', function() {
      var fixture = {
        png: 'sample-image-small-one.png'
      };

      before(function() {
        return fixtures.fetchFixtures(fixture);
      });

      it.only('uploads image to board open space', function() {
        var testScr;
        return ensureBoard()
          .then(function(board) {
            return party.mccoy.spark.board._uploadImage(board, fixture.png);
          })
          .then(function(scr) {
            console.log('HI');
            testScr = scr;
            return party.spock.spark.encryption.download(scr);
          })
          .then(function(file) {
            assert(fixtures.isMatchingFile(file, fixture.png));
          });
      });

      it('uploads image to board hidden space', function() {
        return ensureBoard()
          .then(function(board) {
            return party.mccoy.spark.board._uploadImage(board, fixture.png, {hiddenSpace: true});
          })
          .then(function(scr) {
            return party.mccoy.spark.encryption.download(scr);
          })
          .then(function(file) {
            assert(fixtures.isMatchingFile(file, fixture.png));
          });
      });
    });

    describe('Realtime', function() {

      // Disconnect from board mercury socket
      after(function() {
        // assert.isDefined(board);
        // todo - walk through the list of users in party, and disconnect each one.
        var disconnectSpock = party.spock.spark.board.realtime.disconnect()
          .then(function resetWSUrl() {
            // only remove the websocket url if we are manually disconnecting.
            // otherwise, mercury will automatically try to re-connect on connection failures.
            party.spock.spark.board.realtime.set({boardWebSocketUrl: ''});
            party.spock.spark.board.realtime.set({boardBindings: []});
          });

        var disconnectMcCoy = party.mccoy.spark.board.realtime.disconnect()
          .then(function resetWSUrl() {
            // only remove the websocket url if we are manually disconnecting.
            // otherwise, mercury will automatically try to re-connect on connection failures.
            party.mccoy.spark.board.realtime.set({boardWebSocketUrl: ''});
            party.mccoy.spark.board.realtime.set({boardBindings: []});
          });

        return Promise.all([disconnectSpock, disconnectMcCoy]);
      });

      describe('STRING', function() {
        describe('#publish()', function() {
          var uniqueRealtimeData;

          before(function() {
            uniqueRealtimeData = uuid.v4();
            return ensureBoard();
          });


          it('posts a message to the specified board', function(done) {

            var data = {
              envelope: {
                channelId: board,
                roomId: conversation.id
              },
              payload: {
                msg: uniqueRealtimeData
              }
            };

            // mccoy is going to listen for RT data and confirm that we have the
            // same data that was sent.
            party.mccoy.spark.board.realtime.once('board.activity', function(boardData) {
              assert.equal(boardData.contentType, 'STRING');
              assert.equal(boardData.payload.msg, uniqueRealtimeData);
              done();
            });

            // confirm that both are listening.
            assert(party.spock.spark.board.realtime.listening, 'spock is not listening');
            assert(party.mccoy.spark.board.realtime.listening, 'mccoy is not listening');

            // do not return promise because we want done() to be called on
            // board.activity
            party.spock.spark.board.realtime.publish(board, data);
          });
        });
      });

      describe('FILE', function() {
        describe('#publish()', function() {
          var testScr;
          var fixture = {
            png: 'sample-image-small-one.png'
          };

          before(function() {
            return Promise.all([
              ensureBoard(),
              fixtures.fetchFixtures(fixture)
            ]);
          });

          it('uploads file to board which includes loc', function() {
            return party.mccoy.spark.board._uploadImage(board, fixture.png)
              .then(function(scr) {
                assert.property(scr, 'loc');
                testScr = scr;
              });
          });

          it('posts a file to the specified board', function(done) {

            var data = {
              envelope: {
                channelId: board,
                roomId: conversation.id
              },
              payload: {
                displayName: 'image.png',
                type: 'FILE',
                file: {
                  scr: testScr
                }
              }
            };

            // mccoy is going to listen for RT data and confirm that we have the
            // same data that was sent.
            party.mccoy.spark.board.realtime.once('board.activity', function(boardData) {
              assert.equal(boardData.contentType, 'FILE');
              assert.equal(boardData.payload.file.scr.loc, testScr.loc);
              assert.equal(boardData.payload.displayName, 'image.png');
              done();
            });

            // confirm that both are listening.
            assert(party.spock.spark.board.realtime.listening, 'spock is not listening');
            assert(party.mccoy.spark.board.realtime.listening, 'mccoy is not listening');

            // do not return promise because we want done() to be called on
            // board.activity
            party.spock.spark.board.realtime.publish(board, data);
          });
        });
      });
    });

    describe('Persistence', function() {
      describe('#getChannel', function() {
        before(function() {
          return ensureBoard();
        });

        it('gets the channel metadata', function() {
          return party.mccoy.spark.board.persistence.getChannel(board)
            .then(function(channel) {
              assert.property(channel, 'kmsResourceUrl');
              assert.property(channel, 'aclUrl');

              assert.equal(channel.channelUrl, board.channelUrl);
              assert.equal(channel.aclUrlLink, conversation.aclUrl);
              assert.notEqual(channel.kmsResourceUrl, conversation.kmsResourceObjectUrl);
              assert.notEqual(channel.aclUrl, conversation.aclUrl);
              assert.notEqual(channel.defaultEncryptionKeyUrl, conversation.defaultActivityEncryptionKeyUrl);
            });
        });
      });

      describe('#ping()', function() {
        it('pings persistence board service', function() {
          return party.mccoy.spark.board.persistence.ping()
            .then(function(res) {
              assert.property(res, 'serviceName');
              assert.equal(res.serviceName, 'Board');
            })
            .catch(function(reason) {
              assert.fail(reason, 0, 'ping fails');
            });
        });
      });

      describe('#addImage()', function() {
        var testContent;
        var testScr;

        var fixture = {
          png: 'sample-image-small-one.png'
        };

        before(function() {

          return fixtures.fetchFixtures(fixture)
            .then(function() {
              return ensureBoard();
            });
        });

        after(function() {
          return party.mccoy.spark.board.persistence.deleteAllContent(board);
        });

        it('uploads image to board open space', function() {
          return party.mccoy.spark.board.persistence.addImage(board, fixture.png)
            .then(function(fileContent) {
              testContent = fileContent[0].items[0];
              assert.equal(testContent.type, 'FILE', 'content type should be image');
              assert.property(testContent, 'file', 'content should contain file property');
              assert.property(testContent, 'contentId', 'content should contain contentId property');
              assert.property(testContent, 'payload', 'content should contain payload property');
              assert.property(testContent, 'encryptionKeyUrl', 'content should contain encryptionKeyUrl property');
            });
        });

        it('adds to presistence', function() {
          return party.mccoy.spark.board.persistence.getAllContent(board)
            .then(function(allContents) {
              var imageContent = find(allContents, {contentId: testContent.contentId});
              assert.isDefined(imageContent);
              assert.property(imageContent, 'file');
              assert.property(imageContent.file, 'scr');
              assert.equal(imageContent.displayName, 'sample-image-small-one.png');
              testScr = imageContent.file.scr;
              return imageContent.scr;
            });
        });

        it('matches file file downloaded', function() {
          return party.mccoy.spark.encryption.download(testScr)
            .then(function(file) {
              assert(fixtures.isMatchingFile(file, fixture.png));
            });
        });
      });

      describe('#getContents()', function() {

        before(function() {
          return ensureBoard();
        });

        afterEach(function() {
          return party.mccoy.spark.board.persistence.deleteAllContent(board);
        });

        it('adds and gets contents from the specified board', function() {
          var contents = [{type: 'curve'}];
          var data = [{
            type: contents[0].type,
            payload: JSON.stringify(contents[0])
          }];

          return party.mccoy.spark.board.persistence.addContent(board, data)
            .then(function() {
              return party.mccoy.spark.board.persistence.getAllContent(board);
            })
            .then(function(res) {
              assert.equal(res[0].payload, data[0].payload);
            });
        });

        it('allows other people to read contents', function() {
          var contents = [{type: 'curve', points: [1,2,3,4]}];
          var data = [{
            type: contents[0].type,
            payload: JSON.stringify(contents[0])
          }];

          return party.spock.spark.board.persistence.addContent(board, data)
            .then(function() {
              return party.mccoy.spark.board.persistence.getAllContent(board);
            })
            .then(function(res) {
              assert.equal(res[0].payload, data[0].payload);
              return party.checkov.spark.board.persistence.getAllContent(board);
            })
            .then(function(res) {
              assert.equal(res[0].payload, data[0].payload);
            });
        });

        it('allows other people to write contents', function() {
          var contents = [{type: 'curve', points: [2,2,4,4]}];
          var data = [{
            type: contents[0].type,
            payload: JSON.stringify(contents[0])
          }];

          return party.checkov.spark.board.persistence.addContent(board, data)
            .then(function() {
              return party.mccoy.spark.board.persistence.getAllContent(board);
            })
            .then(function(res) {
              assert.equal(res[0].payload, data[0].payload);
            });
        });

        it('can deal with tons of contents by pagination', function() {
          var tonsOfContents = generateTonsOfContents(400);
          return party.mccoy.spark.board.persistence.addContent(board, tonsOfContents)
            .then(function() {
              return party.mccoy.spark.board.persistence.getAllContent(board);
            })
            .then(function(res) {
              assert.equal(res.length, tonsOfContents.length);
              for (var i = 0; i < res.length; i++) {
                assert.equal(res[i].payload, tonsOfContents[i].payload);
              }
            });
        });
      });

      describe('#deleteContent()', function() {
        beforeEach(function() {
          return ensureBoard();
        });

        after(function() {
          return party.mccoy.spark.board.persistence.deleteAllContent(board);
        });

        it('delete contents from the specified board', function() {
          var channel = board;
          var contents = [
            {
              id: uuid.v4(),
              type: 'file'
            },
            {
              id: uuid.v4(),
              type: 'string'
            }
          ];
          var data = [
            {
              type: contents[0].type,
              payload: JSON.stringify(contents[0])
            },
            {
              type: contents[1].type,
              payload: JSON.stringify(contents[1])
            }
          ];
          return party.mccoy.spark.board.persistence.addContent(channel, data)
            .then(function() {
              return party.mccoy.spark.board.persistence.deleteAllContent(channel);
            })
            .then(function() {
              return party.mccoy.spark.board.persistence.getAllContent(channel);
            })
            .then(function(res) {
              assert.equal(res.length, 0);
              return res;
            })
            .then(function() {
              return party.mccoy.spark.board.persistence.addContent(channel, data);
            })
            .then(function(res) {
              assert.equal(res[0].items.length, 2);
              var content = res[0].items[0];
              console.log('contentId: ', content.contentId);
              return party.mccoy.spark.board.persistence.deleteContent(channel, content);
            })
            .then(function() {
              return party.mccoy.spark.board.persistence.getAllContent(channel);
            })
            .then(function(res) {
              assert.equal(res.length, 1);
              assert.equal(res[0].payload, data[1].payload);
              return res;
            });
        });
      });

      describe('#getChannels', function() {

        beforeEach(function() {
          return ensureBoard();
        });

        it('retrieves a newly created board for a specified conversation within a single page', function() {
          return party.spock.spark.board.persistence.getChannels(conversation)
            .then(function(getChannelsResp) {
              var channelFound = find(getChannelsResp.items, {channelId: board.channelId});
              assert.isDefined(channelFound);
              assert.notProperty(getChannelsResp.links, 'next');
            });
        });

        it('retrieves all boards for a specified conversation across multiple pages', function() {
          var pageLimit = 10;
          var conversation;

          return party.spock.spark.conversation.create({
            displayName: 'Test Board Conversation',
            participants: pluck(party, 'id')
          })
            .then(function(conversationResp) {
              conversation = conversationResp;
              var promises = [];

              for (var i = 0; i < pageLimit + 1; i++) {
                promises.push(party.spock.spark.board.persistence.createChannel(conversation, {}));
              }
              return Promise.all(promises);
            })
            .then(function() {
              return party.spock.spark.board.persistence.getChannels(conversation, {
                channelsLimit: pageLimit
              });
            })
            .then(function(getChannelsResp) {
              assert.lengthOf(getChannelsResp.items, pageLimit);
              assert.property(getChannelsResp, 'links');
              assert.property(getChannelsResp.links, 'next');
              assert.isString(getChannelsResp.links.next);

              return party.spock.spark.request({
                uri: getChannelsResp.links.next
              })
                .then(function(res) {
                  return res.body;
                });
            })
            .then(function(getChannelsResp) {
              assert.lengthOf(getChannelsResp.items, 1);
              assert.notProperty(getChannelsResp, 'links');
            });
        });
      });
    });
  });
});
