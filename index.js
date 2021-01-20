const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 8000;
const axios = require('axios');
const axiosRetry = require('axios-retry');
const convert = require('xml-js');
const NodeCache = require('node-cache');

const corsOptions = { origin: '*' };
axiosRetry(axios, {retries: 5});
const productCache = new NodeCache({stdTTL: 60 * 5, deleteOnExpire: true});
const baseUrl = 'https://bad-api-assignment.reaktor.com';
const productUrl = `${baseUrl}/v2/products`
const manufacturerUrl = `${baseUrl}/v2/availability`
const productsCategory = ['gloves', 'facemasks', 'beanies']
let cacheIsUpdating = false;

updateCache()
setInterval(updateCache, 1000 * 60 * 4)

async function updateCache() {
  console.log('hello money')
  if (cacheIsUpdating) { return }
  cacheIsUpdating = true

  try {
    let cacheUpdatePromises = []
    productsCategory.map(productsByCategory => {
      cacheUpdatePromises.push(new Promise(async (resolve, reject) => {
        try {
          let fetchedProductsData = await axios.get(`${productUrl}/${productsByCategory}`)

          let manufacturersSet = new Set()
          fetchedProductsData.data.map(item => manufacturersSet.add(item.manufacturer))

          let promisesList = []
          manufacturersSet.forEach(manufacturer => {
            promisesList.push(axios.get(`${manufacturerUrl}/${manufacturer}`))
          })

          let manufacturersDataMap = new Map()
          const allPromiseResults = await Promise.allSettled(promisesList)
          allPromiseResults.map(result => {
            if (result.status !== 'fulfilled') {
              console.log('A PROMISE FAILED!!!')
            } else {
              if (result.value.status !== 200) {
                console.log('FETCH REQUEST FAILED, RETURNED' + result.value.status)
              } else {
                if (result.value.data.response && result.value.data.response.length > 0 && result.value.data.response !== '[]') {
                  result.value.data.response.map( item => {
                    manufacturersDataMap.set(item.id.toLowerCase(), convert.xml2js(item.DATAPAYLOAD, {compact: true})
                    )
                  })
                }
              }
            }
          })

          fetchedProductsData.data.map(item => {
          if(manufacturersDataMap.has(item.id)) {
              item.instock = manufacturersDataMap.get(item.id).AVAILABILITY.INSTOCKVALUE._text
            } else {
              item.instock = 'INFORMATIOM NOT AVAILABLE AT THIS TIME'
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
  } catch (error) {
    console.log('shit hit fan with the big try ', error)
  }
  finally {
    cacheIsUpdating = false
  }
};

productsCategory.map( async (productsByCategory) => {
  app.get(`/${productsByCategory}`, cors(corsOptions), async (req, res) => {
    let fetchedProductsDatafromCache = productCache.get(productsByCategory)
    if(!fetchedProductsDatafromCache) {
      await updateCache()
      fetchedProductsDatafromCache = productCache.get(productsByCategory)
      let retryCount = 0
      while (!fetchedProductsDatafromCache && retryCount < 5) {
        await new Promise (resolve => setTimeout(resolve, 5000))
        fetchedProductsDatafromCache = productCache.get(productsByCategory)
        retryCount++
      }
    }
    res.send(fetchedProductsDatafromCache)
  })
})

app.listen(port, () => {
  console.log(`Example app listening at: ${port}`)
});