#!/usr/bin/env node

const path = require('path')
const http = require('http')
const url = require('url')

const { logLevel, loadModel, transcriptFromFile, transcriptFromBuffer, freeModel } = require('./voskjs')
const { getArgs } = require('./lib/getArgs')

//const HTTP_METHOD = 'GET' 
const HTTP_PATH = '/transcript'
const HTTP_PORT =  process.env.PORT || 3000  

/**
 * Module global variables
 */
let debug
let activeRequests = 0
let model
let modelName

function unixTimeMsecs() {
  return Math.floor(Date.now())
}  

function header(programName) {
  return [ 
    `${programName} is a simple HTTP JSON server, loading a Vosk engine model to transcript speeches.`,
    'The server has two endpoints:',
    '',
    '- HTTP GET /transcript',
    '  The request query string arguments contain parameters,',
    '  including a WAV file name already accessible by the server.',
    '',
    '- HTTP POST /transcript',
    '  The request query string arguments contain parameters,',
    '  the request body contains the WAV file name to be submitted to the server.',
  ]  
}


function helpAndExit(programName) {
  
  console.info()
  for (const line of header(programName))
    console.log(line)

  console.info()
  console.info('Usage:')
  console.info()
  console.info(`    ${programName} --model=<model directory path> \\ `)
  console.info('                  [--port=<port number> \\')
  console.info('                  [--debug[=<vosk log level>]]')
  console.info()    
  console.info('Server settings examples:')
  console.info()    
  console.info('    stdout includes the server internal debug logs and Vosk debug logs (log level 2)')
  console.info(`    node ${programName} --model=../models/vosk-model-en-us-aspire-0.2 --port=8086 --debug=2`)
  console.info()    
  console.info('    stdout includes the server internal debug logs without Vosk debug logs (log level -1)')
  console.info(`    node ${programName} --model=../models/vosk-model-en-us-aspire-0.2 --port=8086 --debug`)
  console.info()    
  console.info('    stdout includes minimal info, just request and response messages')
  console.info(`    node ${programName} --model=../models/vosk-model-en-us-aspire-0.2 --port=8086`)
  console.info()    
  console.info('    stdout includes minimal info, default port number is 3000')
  console.info(`    node ${programName} --model=../models/vosk-model-small-en-us-0.15`)
  console.info()
  console.info('Client requests examples:')
  console.info()
  console.info('    1. GET /transcript - query string includes just the speech file argument')
  console.info()    
  console.info('    curl -s \\ ')
  console.info('         -X GET \\ ')
  console.info('         -H "Accept: application/json" \\ ')
  console.info('         -G \\ ')
  console.info('         --data-urlencode speech="../audio/2830-3980-0043.wav" \\ ')
  console.info('         http://localhost:3000/transcript')
  console.info()    
  console.info('    2. GET /transcript - query string includes arguments: speech, model')
  console.info()    
  console.info('    curl -s \\ ')
  console.info('         -X GET \\ ')
  console.info('         -H "Accept: application/json" \\ ')
  console.info('         -G \\ ')
  console.info('         --data-urlencode speech="../audio/2830-3980-0043.wav" \\ ')
  console.info('         --data-urlencode model="vosk-model-en-us-aspire-0.2" \\ ')
  console.info('         http://localhost:3000/transcript')
  console.info()    
  console.info('    3. GET /transcript - query string includes arguments: id, speech, model')
  console.info()    
  console.info('    curl -s \\ ')
  console.info('         -X GET \\ ')
  console.info('         -H "Accept: application/json" \\ ')
  console.info('         -G \\ ')
  console.info('         --data-urlencode id="1620060067830" \\ ')
  console.info('         --data-urlencode speech="../audio/2830-3980-0043.wav" \\ ')
  console.info('         --data-urlencode model="vosk-model-en-us-aspire-0.2" \\ ')
  console.info('         http://localhost:3000/transcript')
  console.info()
  console.info('    4. GET /transcript - includes arguments: id, speech, model, grammar')
  console.info()    
  console.info('    curl -s \\ ')
  console.info('         -X GET \\ ')
  console.info('         -H "Accept: application/json" \\ ')
  console.info('         -G \\ ')
  console.info('         --data-urlencode id="1620060067830" \\ ')
  console.info('         --data-urlencode speech="../audio/2830-3980-0043.wav" \\ ')
  console.info('         --data-urlencode model="vosk-model-en-us-aspire-0.2" \\ ')
  console.info('         --data-urlencode grammar="["experience proves this"]" \\ ')
  console.info('         http://localhost:3000/transcript')
  console.info()
  console.info('    5. POST /transcript - body includes the speech file')
  console.info()    
  console.info('    curl -s \\ ')
  console.info('         -X POST \\ ')
  console.info('         -H "Accept: application/json" \\ ')
  console.info('         -H "Content-Type: audio/wav" \\ ')
  console.info('         --data-urlencode id="1620060067830" \\ ')
  console.info('         --data-urlencode model="vosk-model-en-us-aspire-0.2" \\ ')
  console.info('         --data-binary="@../audio/2830-3980-0043.wav" \\ ')
  console.info('         http://localhost:3000/transcript')
  console.info()    

  process.exit(1)

}  


/**
 * validateArgs
 * command line parsing
 *
 * @param {String}                    args
 * @param {String}                    programName
 *
 * @returns {SentenceAndAttributes}
 * @typedef {Object} SentenceAndAttributes
 * @property {String} language 
 * 
 */
function validateArgs(args, programName) {


  // model is a cli mandatory argument
  const modelDirectory = args.model 

  if ( !modelDirectory ) 
    helpAndExit(programName)
  
  // if not set, port cli argument has a default
  const port = !args.port ? HTTP_PORT : args.port 

  // debug cli argument must be an integer or a boolean
  const debugLevel = args.debug

  return { modelDirectory, port, debugLevel }
}


/**
 * log
 *
 * @param {String} text
 * @param {String} type
 * @param {String} time
 * @return {Number} timestamp
 *
 */
function log(text, type, time=unixTimeMsecs()) {

  //const time = unixTimeMsecs()

  if (type)
    console.log(`${time} ${type} ${text}`)
  else
    console.log(`${time} ${text}`)

  return time

}


/**
 * errorResponse
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status
 */ 
function errorResponse(message, statusCode, res) {
  res.statusCode = statusCode
  res.end(`{"error":"${message}"}`)
  log(message, 'ERROR')
}

function successResponse(requestId, json, res) {
  log(`response ${requestId} ${json}`)
  res.end(json)
}

async function requestListener(req, res) {

  res.setHeader('Content-Type', 'application/json')

  if ( !req.url.match(/^\/transcript/) )
    return errorResponse(`path not allowed ${req.url}`, 405, res)

  // HTTP GET /transcript
  if (req.method === 'GET') { 

    // get request query string arguments
    // https://nodejs.org/en/knowledge/HTTP/clients/how-to-access-query-string-parameters/
    const queryObject = url.parse(req.url,true).query
    
    const requestedModelName = queryObject.model 
    const requestedFilename = queryObject.speech 
    const requestedGrammar = queryObject.grammar 
    const requestedId = queryObject.id 
  
    // set id to the is query string argument 
    // if id argument is not present in the quesy string, 
    // set the id with current timestamp in msecs.
    const currentTime = unixTimeMsecs()
    const id = requestedId ? requestedId : currentTime

    // log request  
    log(`request GET ${id} ${requestedFilename} ${requestedModelName? requestedModelName : ''} ${requestedGrammar? requestedGrammar : ''}`, null, currentTime)

    // validate query string arguments 

    // body must have attributes "speech" and "model"
    if ( !requestedFilename ) 
      return errorResponse(`id ${id} "speech" attribute not found in the body request`, 405, res)

    // if query argument "model" is specified in the client request,
    // it must be equal to the model name loaded by the server
    if ( requestedModelName && (requestedModelName !== modelName) ) 
      return errorResponse(`id ${id} Vosk model ${model} unknown`, 404, res)

    return responseTranscriptGet(id, requestedFilename, requestedModelName, requestedGrammar, res)
  }

  // HTTP POST /transcript
  if (req.method === 'POST') {
    
    // get request query string arguments
    const queryObject = url.parse(req.url,true).query

    const requestedModelName = queryObject.model 
    const requestedGrammar = queryObject.grammar 
    const requestedId = queryObject.id 
  
    // set id to the is query string argument 
    // if id argument is not present in the quesy string, 
    // set the id with current timestamp in msecs.
    const currentTime = unixTimeMsecs()
    const id = requestedId ? requestedId : currentTime

    // log POST request  
    log(`request POST ${id} ${'speechBuffer'} ${requestedModelName? requestedModelName: ''} ${requestedGrammar? requestedGrammar: ''}`, null, currentTime)

    // if query argument "model" is specified in the client request,
    // it must be equal to the model name loaded by the server
    if ( requestedModelName && (requestedModelName !== modelName) ) 
      return errorResponse(`id ${id} Vosk model ${model} unknown`, 404, res)

    // get request body binary data
    // containing speech WAV file 
    // TODO Validation of body  
    let body = []
    
    req.on('data', (chunk) => { body.push(chunk) })

    // all the body is received 
    req.on('end', () => {
      
      const speechAsBuffer = Buffer.concat(body)
    
      responseTranscriptPost(id, speechAsBuffer, requestedModelName, requestedGrammar, res)
    
    })
  }  
  
  // all other HTTP methods 
  else
    return errorResponse(`method not allowed ${req.method}`, 405, res)

}  


async function responseTranscriptGet(id, requestedFilename, requestedModelName, requestedGrammar, res) {

  try {

    if (debug) {
      // new thread started, increment global counter of active thread running
      activeRequests++
      log(`active requests ${activeRequests}`, 'debug')
    }

    // speech recognition of an audio file
    const grammar = requestedGrammar ? JSON.parse(requestedGrammar) : undefined
    const transcriptData = await transcriptFromFile(requestedFilename, model, {grammar})

    if (debug) {
      // thread finished, decrement global counter of active thread running
      activeRequests--
      log(`active requests ${activeRequests}`, 'debug')
    }  

    const latency = transcriptData.latency
    
    // return JSON data structure
    const responseJson = JSON.stringify({
      //... { request: JSON.stringify(queryObject) },
      ... { id },
      ... { latency },
      ... transcriptData.result 
      })

    if (debug)
      log(`latency ${id} ${latency}ms`, 'debug')
    
    return successResponse(id, responseJson, res)

  }
  catch (error) {
    return errorResponse(`id ${id} transcript function ${error}`, 415, res)
  }  

}  


async function responseTranscriptPost(id, buffer, requestedModelName, requestedGrammar, res) {

  try {

    if (debug) {
      // new thread started, increment global counter of active thread running
      activeRequests++
      log(`active requests ${activeRequests}`, 'debug')
    }

    // speech recognition of an audio file
    const grammar = requestedGrammar ? JSON.parse(requestedGrammar) : undefined
    const transcriptData = await transcriptFromBuffer(buffer, model, {grammar} )

    if (debug) {
      // thread finished, decrement global counter of active thread running
      activeRequests--
      log(`active requests ${activeRequests}`, 'debug')
    }  

    const latency = transcriptData.latency
    
    // return JSON data structure
    const responseJson = JSON.stringify({
      ... { id },
      ... { latency },
      ... transcriptData.result 
    })

    if (debug)
      log(`latency ${id} ${latency}ms`, 'debug')
    
    return successResponse(id, responseJson, res)

  }  
  catch (error) {
    return errorResponse(`id ${id} transcript function ${error}`, 415, res)
  }  

}  


function shutdown(signal) {

  log(`${signal} received`)
  
  // free the Vosk runtime model
  freeModel(model)
  
  log('Shutdown done')
  
  process.exit(0)
}  


async function main() {

  let voskLogLevel

  // get command line arguments 
  const { args } = getArgs()
  
  const programName = path.basename(__filename, '.js')

  const { modelDirectory, port, debugLevel } = validateArgs(args, programName )

  // set modelName as a global variable
  modelName = path.basename(modelDirectory, '/')

  // debug cli argument not set, 
  // internal httpServer debug and Vosk log level are unset
  if ( ! debugLevel ) { 
    debug = false
    voskLogLevel = -1
    logLevel(voskLogLevel) 
  }  
  
  // internal httpServer debug is set but Vosk log level is unset
  else if ( debugLevel === true ) {
    debug = true
    voskLogLevel = -1
    logLevel(voskLogLevel) 
  }

  // debug cli argument s an integer,
  // internal debug is set and Vosk log level is set to corresponding value
  else if ( Number.isInteger(+debugLevel) ) {
    debug = true
    voskLogLevel = +debugLevel
    logLevel(voskLogLevel) 
  }

  //for (const line of header(programName))
  // log(line)

  log(`Model path: ${modelDirectory}`)
  log(`Model name: ${modelName}`)
  log(`HTTP server port: ${port}`)
  log(`internal debug log: ${debug}`)
  log(`Vosk log level: ${voskLogLevel}`)

  let latency

  log(`wait loading Vosk model: ${modelName} (be patient)`);

  // create a Vosk runtime model
  ( { model, latency } = await loadModel(modelDirectory) );

  log(`Vosk model loaded in ${latency} msecs`)

  // create the HTTP server instance
  const server = http.createServer( (req, res) => requestListener(req, res) )

  // listen incoming client requests
  server.listen( port, () => {
    log(`server ${path.basename(__filename)} running at http://localhost:${port}`)
    log(`endpoint http://localhost:${port}${HTTP_PATH}`)
    log('press Ctrl-C to shutdown')
    log('ready to listen incoming requests')
  })
  
  // shutdown management
  process.on('SIGTERM', shutdown )
  process.on('SIGINT', shutdown )

  //
  // Shutdown on uncaughtException 
  // https://flaviocopes.com/node-exceptions/
  //
  process.on('uncaughtException', (err) => { 
      log(`there was an uncaught error: ${err}`, 'FATAL')
      shutdown('uncaughtException')
  })
  

}

main()

