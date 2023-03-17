import { deepAccess, deepSetValue, generateUUID, logError, logInfo, mergeDeep } from '../src/utils.js';
import { getRefererInfo } from '../src/refererDetection.js';
import { ajax } from '../src/ajax.js';
import { submodule } from '../src/hook.js';
import * as events from '../src/events.js';
import CONSTANTS from '../src/constants.json';

export const DATA_PROVIDER = 'neuwo.ai';
const RESPONSE_IAB_TIER_1 = 'marketing_categories.iab_tier_1'
const RESPONSE_IAB_TIER_2 = 'marketing_categories.iab_tier_2'

function init(config, userConsent) {
  config.params = config.params || {}
  // ignore module if publicToken is missing (module setup failure)
  if (!config.params.publicToken) {
    logError('publicToken missing', 'NeuwoRTDModule', 'config.params.publicToken')
    return false;
  }
  if (!config.params.apiUrl) {
    logError('apiUrl missing', 'NeuwoRTDModule', 'config.params.apiUrl')
    return false;
  }
  return true;
}

export function getBidRequestData(reqBidsConfigObj, callback, config, userConsent) {
  config.params = config.params || {};
  logInfo('NeuwoRTDModule', 'starting getBidRequestData')

  const wrappedArgUrl = encodeURIComponent(config.params.argUrl || getRefererInfo().page);
  /* adjust for pages api.url?prefix=test (to add params with '&') as well as api.url (to add params with '?') */
  const joiner = config.params.apiUrl.indexOf('?') < 0 ? '?' : '&'
  const url = config.params.apiUrl + joiner + [
    'token=' + config.params.publicToken,
    'url=' + wrappedArgUrl
  ].join('&')
  const billingId = generateUUID();

  const success = (responseContent) => {
    logInfo('NeuwoRTDModule', 'GetAiTopics: response', responseContent)
    try {
      const jsonContent = JSON.parse(responseContent);
      if (jsonContent.marketing_categories) {
        events.emit(CONSTANTS.EVENTS.BILLABLE_EVENT, { type: 'request', billingId, vendor: neuwoRtdModule.name })
      }
      injectTopics(jsonContent, reqBidsConfigObj, billingId)
    } catch (ex) {
      logError('NeuwoRTDModule', 'Response to JSON parse error', ex)
    }
    callback()
  }

  const error = (err) => {
    logError('xhr error', null, err);
    callback()
  }

  ajax(url, {success, error}, null, {
    // could assume Origin header is set, or
    // customHeaders: { 'Origin': 'Origin' }
  })
}

export function addFragment(base, path, addition) {
  const container = {}
  deepSetValue(container, path, addition)
  mergeDeep(base, container)
}

/**
 * Concatenate a base array and an array within an object
 * non-array bases will be arrays, non-arrays at object key will be discarded
 * @param {array} base base array to add to
 * @param {object} source object to get an array from
 * @param {string} key dot-notated path to array within object
 * @returns base + source[key] if that's an array
 */
function combineArray(base, source, key) {
  if (Array.isArray(base) === false) base = []
  const addition = deepAccess(source, key, [])
  if (Array.isArray(addition)) return base.concat(addition)
  else return base
}

export function injectTopics(topics, bidsConfig) {
  topics = topics || {}

  // join arrays of IAB category details to single array
  const combinedTiers = combineArray(
    combineArray([], topics, RESPONSE_IAB_TIER_1),
    topics, RESPONSE_IAB_TIER_2)

  const segment = pickSegments(combinedTiers)
  // effectively gets topics.marketing_categories.iab_tier_1, topics.marketing_categories.iab_tier_2
  // used as FPD segments content

  const IABSegments = {
    name: DATA_PROVIDER,
    segment
  }

  addFragment(bidsConfig.ortb2Fragments.global, 'site.content.data', [IABSegments])

  if (segment.length > 0) {
    addFragment(bidsConfig.ortb2Fragments.global, 'site.pagecat', segment.map(s => s.id))
  }

  logInfo('NeuwoRTDModule', 'injectTopics: post-injection bidsConfig', bidsConfig)
}

/**
 * map array of objects to segments
 * @param {Array[{ID: string}]} normalizable
 * @returns array of IAB "segments"
 */
export function pickSegments(normalizable) {
  if (Array.isArray(normalizable) === false) return []
  return normalizable.map((k) => { if (k) k.id = k.id || k.ID; return k })
    .filter(t => t && t.id)
}

export const neuwoRtdModule = {
  name: 'NeuwoRTDModule',
  init,
  getBidRequestData
}

submodule('realTimeData', neuwoRtdModule)
