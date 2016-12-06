/**!
 *
 * Copyright (c) 2015-2016 Cisco Systems, Inc. See LICENSE file.
 */

'use strict';

var assign = require('lodash.assign');
var SparkBase = require('../../../../lib/spark-base');
var chunk = require('lodash.chunk');
var pick = require('lodash.pick');
var promiseSeries = require('es6-promise-series');
// number is hard-coded in board service atm
var MAX_ALLOWED_INPUT_SIZE = 150;

/**
 * @class
 * @extends {SparkBase}
 * @memberof Board
 */
var PersistenceService = SparkBase.extend({

  namespace: 'Board',

  /**
   * Adds Content to a Channel
   * If contents length is greater than MAX_ALLOWED_INPUT_SIZE, this method
   * will break contents into chunks and make multiple GET request to the
   * board service
   * @memberof Board.PersistenceService
   * @param  {Board~Channel} channel
   * @param  {Array} contents - Array of {@link Board~Content} objects
   * @return {Promise<Board~Content>}
   */
  addContent: function addContent(channel, contents) {
    var chunks = [];
    chunks = chunk(contents, MAX_ALLOWED_INPUT_SIZE);
    // we want the first promise to resolve before continuing with the next
    // chunk or else we'll have race conditions among patches
    return promiseSeries(chunks.map(function _addContent(part) {
      return this._addContentChunk.bind(this, channel, part);
    }, this));
  },

  /**
   * Adds Image to a Channel
   * Uploads image to open space and adds SCR + downloadUrl to the persistence
   * service
   * @memberof Board.PersistenceService
   * @param  {Conversation~ConversationObject} conversation
   * @param  {Board~Channel} channel
   * @param  {File} image - image to be uploaded
   * @param  {Object} options
   * @param  {Object} options.hiddenSpace - upload to hidden space instead of open space
   * @return {Promise<Board~Content>}
   */
  addImage: function addImage(channel, image, options) {
    return this.spark.board._uploadImage(channel, image, options)
      .then(function addContent(scr) {
        return this.spark.board.persistence.addContent(channel, [{
          type: 'FILE',
          displayName: image.name,
          file: {
            url: scr.loc,
            mimeType: image.type,
            size: image.size,
            scr: scr
          }
        }]);
      }.bind(this));
  },

  /**
   * Creates a Channel
   * @memberof Board.PersistenceService
   * @param  {Conversation~ConversationObject} conversation
   * @param  {Board~Channel} channel
   * @return {Promise<Board~Channel>}
   */
  createChannel: function createChannel(conversation, channel) {
    return this._encryptChannel(conversation, channel)
      .then(function requestCreateChannel(preppedChannel) {
        return this.spark.request({
          method: 'POST',
          api: 'board',
          resource: '/channels',
          body: preppedChannel
        });
      }.bind(this))
      .then(function resolveWithBody(res) {
        return res.body;
      });
  },

  _encryptChannel: function _encryptChannel(conversation, channel) {
    channel = this._prepareChannel(conversation, channel);
    return this.spark.board.encryptChannel(channel);
  },

  _prepareChannel: function _prepareChannel(conversation, channel) {
    if (!channel) {
      channel = {};
    }

    channel.aclUrlLink = conversation.aclUrl;
    channel.kmsMessage = {
      method: 'create',
      uri: '/resources',
      userIds: [conversation.kmsResourceObjectUrl],
      keyUris: []
    };

    return channel;
  },

  /**
   * Deletes all Content from a Channel
   * @memberof Board.PersistenceService
   * @param  {Board~Channel} channel
   * @return {Promise} Resolves with an content response
   */
  deleteAllContent: function deleteAllContent(channel) {
    return this.spark.request({
      method: 'DELETE',
      uri: channel.channelUrl + '/contents'
    })
      .then(function resolveWithBody(res) {
        return res.body;
      });
  },

  /**
   * Deletes a specified Content from a Channel
   * @memberof Board.PersistenceService
   * @param  {Board~Channel} channel
   * @param  {Board~Content} content
   * @return {Promise} Resolves with an content response
   */
  deleteContent: function deleteContent(channel, content) {
    return this.spark.request({
      method: 'DELETE',
      uri: content.contentUrl
    })
      .then(function resolveWithBody(res) {
        return res.body;
      });
  },

  /**
   * Gets all Content from a Channel
   * It will make multiple GET requests if contents length are greater than
   * MAX_ALLOWED_INPUT_SIZE, the number is currently determined and hard-coded
   * by the backend
   * @memberof Board.PersistenceService
   * @param  {Board~Channel} channel
   * @return {Promise<Array>} Resolves with an Array of {@link Board~Content} objects.
   */
  getAllContent: function getAllContent(channel, query) {
    var defaultQuery = {
      contentsLimit: MAX_ALLOWED_INPUT_SIZE
    };

    query = query ? assign(defaultQuery, pick(query, 'contentsLimit')) : defaultQuery;

    function loop(contents) {
      if (!contents.link || !contents.link.next) {
        return Promise.resolve(contents.items);
      }

      return this.spark.request({
        uri: contents.link.next
      })
        .then(function decryptContents(res) {
          contents.link = this.spark.board.parseLinkHeaders(res.headers.link);
          return this.spark.board.decryptContents(res.body);
        }.bind(this))

        .then(function getMoreContents(res) {
          contents.items = contents.items.concat(res);
          return contents;
        }.bind(this))
        .then(loop.bind(this));
    }

    return this._getPageOfContents(channel, query)
      .then(loop.bind(this));
  },

  /**
   * Gets a Channel
   * @memberof Board.PersistenceService
   * @param  {Board~Channel} channel
   * @return {Promise<Board~Channel>}
   */
  getChannel: function getChannel(channel) {
    return this.spark.request({
      method: 'GET',
      uri: channel.channelUrl
    })
      .then(function resolveWithBody(res) {
        return res.body;
      });
  },

  /**
   * Gets Channels
   * @memberof Board.PersistenceService
   * @param {Conversation~ConversationObject} conversation
   * @param {Object} options
   * @param {number} options.limit Max number of activities to return
   * @return {Promise} Resolves with an array of Channel items
   */
  getChannels: function getChannels(conversation, options) {
    options = options || {};

    if (!conversation) {
      return Promise.reject(new Error('`conversation` is required'));
    }

    var params = {
      api: 'board',
      resource: '/channels',
      qs: {
        aclUrlLink: conversation.aclUrl
      }
    };
    assign(params.qs, pick(options, 'channelsLimit'));

    return this.request(params)
      .then(function resolveWithBody(res) {
        var responseObject = res.body;
        responseObject.links = this.spark.board.parseLinkHeaders(res.headers.link);
        return responseObject;
      }.bind(this));
  },

  /**
   * Pings persistence
   */
  ping: function ping() {
    return this.spark.request({
      method: 'GET',
      api: 'board',
      resource: '/ping'
    })
    .then(function resolveWithBody(res) {
      return res.body;
    });
  },

  /**
   * Registers with Mercury
   * @memberof Board.PersistenceService
   * @param  {Object} data - Mercury bindings
   * @return {Promise<Board~Registration>}
   */
  register: function register(data) {
    return this.spark.request({
      method: 'POST',
      api: 'board',
      resource: '/registrations',
      body: data
    })
      .then(function resolveWithBody(res) {
        return res.body;
      });
  },

  _addContentChunk: function _addContentHelper(channel, contentChunk) {
    return this.spark.board.encryptContents(channel.defaultEncryptionKeyUrl, contentChunk)
      .then(function addContent(res) {
        return this.spark.request({
          method: 'POST',
          uri: channel.channelUrl + '/contents',
          body: res
        });
      }.bind(this))
      .then(function resolveWithBody(res) {
        return res.body;
      });
  },

  _getPageOfContents: function _getPageOfContents(channel, query) {
    query = query ? pick(query, 'sinceDate', 'contentsLimit') : {};
    var nextLink;

    return this.spark.request({
      method: 'GET',
      uri: channel.channelUrl + '/contents',
      qs: query
    })
      .then(function decryptContents(res) {
        nextLink = this.spark.board.parseLinkHeaders(res.headers.link);
        return this.spark.board.decryptContents(res.body);
      }.bind(this))
      .then(function addNextLink(res) {
        return {
          items: res,
          link: nextLink
        };
      }.bind(this));
  }

});

module.exports = PersistenceService;
