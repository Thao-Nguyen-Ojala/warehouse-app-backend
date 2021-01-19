const express = require('express');
const router = express.Router();
const axiosRetry = require('axios-retry')
const axios = require('axios')
const convert = require('xml-js')
const NodeCache = require( "node-cache" );


axiosRetry(axios, {retries: 5})
const productCache = new NodeCache({stdTTL: 60 * 5, deleteOnExpire: true});
const BASE_URL = "https://bad-api-assignment.reaktor.com"
const PRODUCT_ENDPOINT = `${BASE_URL}/v2/products`
const MANUFACTURER_ENDPOINT = `${BASE_URL}/v2/availability`
const PRODUCT_CLASSES = ['gloves', 'facemasks', 'beanies']
let cacheUpdateOngoing = false

updateCache()

async function updateCache() {
  if (cacheUpdateOngoing)
    return
  cacheUpdateOngoing = true
  try {
    let cacheUpdatePromises = []
    PRODUCT_CLASSES.map(productClass => {
      cacheUpdatePromises.push(new Promise(async (resolve, reject) => {
        try {
          const productInfoResp = await axios.get(`${PRODUCT_ENDPOINT}/${productClass}`)

          let manuSet = new Set()
          productInfoResp.data.map(item => manuSet.add(item.manufacturer))

          let promiseList = []
          manuSet.forEach(manu => {
            promiseList.push(axios.get(`${MANUFACTURER_ENDPOINT}/${manu}`))
          })

          let manuDataMap = new Map()
          const allPromiseResult = await Promise.allSettled(promiseList)
          allPromiseResult.map(result => {
            if (result.status !== 'fulfilled') {
              console.log('A PROMISE FAILED!!!')
            } else {
              if (result.value.status !== 200) {
                console.log('FETCH REQUEST FAILED, RETURNED ' + result.value.status)
              } else {
                if (result.value.data.response && result.value.data.response.length > 0 && result.value.data.response !== '[]') {
                  result.value.data.response.map(item => {
                    manuDataMap.set(item.id.toLowerCase(), convert.xml2js(item.DATAPAYLOAD, {compact: true}))
                  })
                }
              }
            }
          })
          productInfoResp.data.map(item => {
            if (manuDataMap.has(item.id)) {
              item.instock = manuDataMap.get(item.id).AVAILABILITY.INSTOCKVALUE._text
            } else {
              item.instock = 'INFORMATION NOT AVAILABLE AT THIS TIME'
            }
          })

          productCache.set(productClass, productInfoResp.data)
          resolve(true)
        } catch(ErrorInDataFetch) {
          reject(ErrorInDataFetch)
        }
      }))
    })
    await Promise.all(cacheUpdatePromises)
  } finally {
    cacheUpdateOngoing = false
  }
}

PRODUCT_CLASSES.map(async productClass => {
  router.get(`/products/${productClass}`, async function(req, res, next) {
    let responseData = productCache.get(productClass)
    if (!responseData) {
      await updateCache()
      responseData = productCache.get(productClass)
      let retryCount = 0
      while (!responseData && retryCount < 5) {
        await new Promise(resolve => setTimeout(resolve, 5000))
        responseData = productCache.get(productClass)
        retryCount++
      }
    }
    res.send(responseData)
  });
})


module.exports = router;
