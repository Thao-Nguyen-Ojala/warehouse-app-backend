const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 8000;
const axios = require('axios');
const convert = require('xml-js');
const NodeCache = require('node-cache');
const corsOptions = { origin: '*' };
const productCache = new NodeCache({stdTTL: 60 * 6, deleteOnExpire: true});
const baseUrl = 'https://bad-api-assignment.reaktor.com';
const productUrl = `${baseUrl}/v2/products`
const manufacturerUrl = `${baseUrl}/v2/availability`
const productsCategory = ['gloves', 'facemasks', 'beanies']
let cacheIsUpdating = false;

updateCache()
setInterval(updateCache, 1000 * 60 * 4)

function axiosGetRetry(url) {
  return new Promise(async (resolve, reject) => {
    let maxTries = 10;
    let result;
    for (let i = 0; i < maxTries; i++) {
      result = await axios.get(url, {timeout: 60 * 1000, headers: {'x-force-error-mode':'all'}})
      if (didAxiosPromiseSucceed(result)) {
        resolve(result)
        return
      }
    }
    reject(`Failed after ${maxTries} attempts`)
  })
}

function didAxiosPromiseSucceed(axiosPromiseResult) {
  if (axiosPromiseResult.status !== 200) {
    return false;
  }
  if (axiosPromiseResult.data.response === '[]') {
    return false;
  }
  return true;
}

async function updateCache() {
  if (cacheIsUpdating) { return }
  cacheIsUpdating = true
  try {
    let cacheUpdatePromises = []
    productsCategory.map(productsByCategory => {
      cacheUpdatePromises.push(new Promise(async (resolve, reject) => {
        try {
          let fetchedProductsData = await axiosGetRetry(`${productUrl}/${productsByCategory}`)

          let manufacturersSet = new Set()
          fetchedProductsData.data.map(item => manufacturersSet.add(item.manufacturer))

          let promisesList = []
          manufacturersSet.forEach(manufacturer => {
            promisesList.push(axiosGetRetry(`${manufacturerUrl}/${manufacturer}`))
          })

          let manufacturersDataMap = new Map()
          const allPromiseResults = await Promise.allSettled(promisesList)
          allPromiseResults.map(result => {
            if (result.status !== 'fulfilled') {
              console.log('A PROMISE FAILED!!!')
            } else {
              result.value.data.response.map( item => {
                manufacturersDataMap.set(item.id.toLowerCase(), convert.xml2js(item.DATAPAYLOAD, {compact: true})
                )
              })
            }
          })

          fetchedProductsData.data.map(item => {
          if(manufacturersDataMap.has(item.id)) {
              item.instock = manufacturersDataMap.get(item.id).AVAILABILITY.INSTOCKVALUE._text
            } else {
              item.instock = 'INFORMATION NOT AVAILABLE AT THIS TIME'
            }
          })
          productCache.set(productsByCategory, fetchedProductsData.data)
          resolve(true)
        } catch (errorInDataFetching) {
          reject(errorInDataFetching)
        }
      }))
    })
    await Promise.all(cacheUpdatePromises)
  } 
  finally {
    cacheIsUpdating = false
  }
};

productsCategory.map( async (productsByCategory) => {
  app.get(`/${productsByCategory}`, cors(corsOptions), async (req, res) => {
    let fetchedProductsDatafromCache = productCache.get(productsByCategory)
    if(!fetchedProductsDatafromCache) {
      try {
        await updateCache()
        fetchedProductsDatafromCache = productCache.get(productsByCategory)
        let retryCount = 0
        while (!fetchedProductsDatafromCache && retryCount < 5) {
          await new Promise (resolve => setTimeout(resolve, 5000))
          fetchedProductsDatafromCache = productCache.get(productsByCategory)
          retryCount++
        }
        res.send(fetchedProductsDatafromCache)
      } catch (error) {
        res.status(500).send('Something goes wrong, please try again later')
      }
    } else {
      res.send(fetchedProductsDatafromCache)
    } 
  })
})

app.listen(port, () => {
  console.log(`Example app listening at: ${port}`)
});