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
    this.timeout(120000);

    // added a third member in order to be able to create another room.
    var party = {
      spock: true,
      mccoy: true,
      checkov: true
    };

    before(function beamDown() {
      return landingparty.beamDown(party);
    });

    describe('Persistence', function() {
      describe.only('#createPrivateChannel', function() {
        it('creates a private board', function() {
          return party.mccoy.spark.board.persistence.createPrivateChannel()
            .then(function(res) {
              console.log('CREATE PRIVATE CHANNEL RES', res);
            });
        });
      });
    });
  });
});
