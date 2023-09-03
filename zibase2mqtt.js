#!/usr/bin/node
/*
 +-+-+-+-+-+-+-+-+-+-+
 |o|n|l|i|n|u|x|.|f|r|
 +-+-+-+-+-+-+-+-+-+-+
 https://github.com/onlinux/Zibase2mqtt

 */
const mqtt = require("mqtt");
const _ = require("underscore");
const request = require("request-promise");
const S = require("string");
const config = require("./config");
const winston = require("winston");
const fs = require("fs");
const moment = require("moment");
const requestQueue = []; // Queue to store received requests
let isProcessing = false; // Flag to track whether requests are being processed
const env = process.env.NODE_ENV || config.env;
const logDir = ".";
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}
var tsFormat = function () {
  return new Date().toLocaleString();
};
const logger = new winston.Logger({
  transports: [
    // colorize the output to the console
    new winston.transports.Console({
      timestamp: tsFormat,
      colorize: true,
      level: env === "development" ? "debug" : "info",
    }),
    new winston.transports.File({
      filename: logDir + "/" + config.logfilename,
      json: false,
      timestamp: tsFormat,
      level: env === "development" ? "debug" : "info",
    }),
  ],
});
var clientIp = process.env.MYIP || getIPAddress();
var zibaseIp;
var home;
var probes = [];
var actuators = [];
var sensors = [];
var scenarios = [];
var cameras = [];
var variables = [];
const debug = config.debug || false;

// MQTT options
const options = config.mqtt_options;
const tags = ["bat", "tem", "hum", "uv", "uvl", "lev", "dev", "rf", "ch", "id"];
logger.debug(config.url);

request(config.url, function (err, resp, body) {
  if (err) {
    logger.error("Could not retrieve data from zibase! ", err);
    return;
  }
  home = JSON.parse(body);
  probes = _.indexBy(home.body.probes, "sid");
  actuators = _.indexBy(home.body.actuators, "id");
  sensors = _.indexBy(home.body.sensors, "id");
  scenarios = _.indexBy(home.body.scenarios, "id");
  variables = home.body.variables;
  cameras = _.indexBy(home.body.cameras, "sid");
});

const dgram = require("dgram");
const { log } = require("console");
const server = dgram.createSocket("udp4");
const client = dgram.createSocket("udp4");
const b = new Buffer.alloc(70);
server.on("error", function (err) {
  logger.info("Server error:\n" + err.stack);
  server.close();
});
server.on("listening", function () {
  var address = server.address();
  logger.info("Server listening " + address.address + ":" + address.port);
});
server.on("message", function (msg, rinfo) {
  processMessage(msg, rinfo);
});
client.on("listening", function () {
  var address = client.address();
  client.setBroadcast(true);
  logger.info("Client listening on port: " + address.port);
});
client.on("message", function (msg, rinfo) {
  var ip = msg.readUInt32BE(38, 4); //msg.readUIntBE if node -v > 11
  zibaseIp = num2dot(ip);
  logger.info(
    msg.toString(undefined, 6, 12) +
      " " +
      msg.toString(undefined, 22, 34) +
      " IP is  " +
      zibaseIp
  );
  if (zibaseIp) {
    //HOST REGISTERING
    b.fill(0);
    b.write("ZSIG\0", 0 /*offset*/);
    b.writeUInt16BE(13, 4); //command HOST REGISTERING (13)
    b.writeUInt32BE(dot2num(clientIp), 50); //Ip address
    b.writeUInt32BE(0x42cc, 54); // port 17100 is 0x42CC

    var ts = Math.round(new Date().getTime() / 1000);
    b.writeUInt32BE(ts, 58); // send timestamp as PARAM3 <---------------------------

    logger.info(
      "HOST REGISTERING sent to " +
        zibaseIp +
        " with " +
        ts.toString() +
        " as timestamp"
    );
    client.send(b, 0, b.length, 49999, zibaseIp, function (err, bytes) {});
  }
});

const mqttclient = mqtt.connect("mqtt://" + config.mqtt_ip, options);
const topic = config.mqtt_topic_hass + "/+/POWER";
const onlineTopic = config.mqtt_topic_hass + "/LWT";

/**
 * Publish zibase2mqtt Gateway's online status to the LWT topic.  Retained.
 * @param {boolean} isOnline - true for online, false for offline
 */
function publishOnlineStatus(isOnline) {
  const message = isOnline ? "Online" : "Offline";
  mqttclient.publish(
    onlineTopic,
    message,
    {
      retain: true,
    },
    (err) => {
      if (err) logger.error(err);
    }
  );
}

mqttclient.on("connect", () => {
  logger.info("mqttclient connected");
  publishOnlineStatus(true);
  mqttclient.subscribe([topic], () => {
    logger.info(`Subscribe to topic '${topic}'`);
  });
});

mqttclient.on("message", (topic, payload) => {
  logger.debug("Received Message:", topic, payload.toString());
  // Message received on POWER subtopic
  // get device id
  device = S(topic).between(config.mqtt_topic_hass, "POWER").strip("/").s;
  // Initialize level in case on Dimmer devices to process brightness
  var level = "";
  // Test if payload is json
  try {
    logger.debug(payload.toString());
    json = JSON.parse(payload.toString());
    cmd = json.state;
    if (cmd == "ON") level = json.brightness;
    if (level) cmd = "DIM";
  } catch (e) {
    // Payload is not json
    cmd = payload.toString();
  }
  var protocol = "P3"; // Default Chacon
  //http://zibase/cgi-bin/domo.cgi?cmd=OFF%20C6%20P10  pour les volets
  //http://zibase/cgi-bin/domo.cgi?cmd=OFF%20G4%20P3   pour Chacon
  if (S(device).contains("RTS433_")) {
    // Is it a cover?
    device = S(device).stripLeft("RTS433_"); // Yes
    protocol = "P10"; // Assign the correct protocol Somfy RTS433 P10
    if (cmd == "DIM")
      // If 'My' button press then set level to 50
      level = "50";
  }
  // On passe par une requestQueue afin de laisser un délai d'au moins 1 seconde
  // entre chaque request vers la zibase, sinon les requests suivant le 1er ne sont pas
  // pris en compte.
  const url = `http://${zibaseIp}/cgi-bin/domo.cgi?cmd=${cmd}%20${device}%20${protocol}%20${level}`;
  requestQueue.push(url);
  // Process the request queue with a one-second delay
  if (!isProcessing) {
    processRequestQueue();
  }
});

async function processRequestQueue() {
  if (requestQueue.length > 0) {
    isProcessing = true; // Set the flag to indicate processing

    const url = requestQueue.shift();

    try {
      const response = await request(url);
      logger.error(`Response from ${url}: ${response}`);
    } catch (error) {
      //logger.error(`Error for ${url}: ${error.message}`);
    }

    // Wait for x second before processing the next request
    setTimeout(() => {
      isProcessing = false; // Reset the processing flag
      logger.debug("Processing next url", requestQueue);
      processRequestQueue(); // Continue processing the queue
    }, 1000);
  }
}

function publish_hass(id, msg) {
  if (mqttclient.connected == true) {
    logger.debug(msg);
    mqttclient.publish(
      config.mqtt_topic_hass + "/events/" + id,
      msg,
      {
        retain: true,
        qos: 1,
      },
      (err) => {
        if (err) logger.error(err);
      }
    );
  } else {
    logger.error("publish_hass MQTT connection False\n");
  }
}

function processMessage(msg, rinfo) {
  var date = moment();
  msg = msg.slice(70);
  msg = msg.toString();
  
  logger.debug(msg.replace(/<(?:.|\n)*?>/gm, "")); // delete all html tags
  if (S(msg).contains("SCENARIO")) {
    var id = msg.replace(/\w* SCENARIO: (\d*)(.*)/, "$1");
    if (id && scenarios[id]) {
      msg = msg + " " + scenarios[id].name;
      logger.info(msg);
    }
  } else if (S(msg).contains("Sent radio ID")) {
    // Received a message sent by zibase to a device
    var brightness;
    var state;
    var position;
    // Sent radio to an actuator then update state of the device
    if (S(msg).contains("DIM/SPECIAL")) {
      state = "DIM";
      id = S(msg).splitRight(" ", -1, 2);
      idx = S(id[0]).strip().s;
      idx = S(idx).strip("_ON", "_OFF", "\u0000").s;
      // parse dim level
      if (S(msg).contains("Chacon")) {
        brightness = S(msg).between("DIM", "%").s;
        state = "ON";
      }
    } else {
      id = S(msg).splitRight(" ", 1);
      idx = S(id[1]).strip().s;
      idx = S(idx).strip("_ON", "_OFF", "\u0000").s;
      if (S(id[1]).contains("_ON")) {
        state = "ON";
      } else if (S(id[1]).contains("_OFF")) {
        state = "OFF";
      }
    }
    device_name = actuators[idx] ? actuators[idx].name : "none";
    if (S(msg).contains("RTS433")) {
      idx = "RTS433_" + idx; //Volets Somfy

      if (state == "ON") {
        state = "open";
        position = 100;
      } else if (state == "OFF") {
        state = "closed";
        position = 0;
      } else if (state == "DIM") {
        state = "stopped";
        position = 10;
      }
    }

    str_hass = `{"Time":"${moment().format()}","type": "actuator","state": "${state}", "id": "${idx}","name": "${device_name}" `;
    if (position > -1) str_hass += `, "position": ${position}`;
    if (brightness) str_hass += `, "brightness": ${brightness}`;

    str_hass += "}";
    publish_hass(idx, str_hass);
  } else {
    var id = S(msg).between("<id>", "</id>").s;
    var bat = S(msg).between("<bat>", "</bat>").s;
    var state = S(id).contains("_OFF") ? "OFF" : "ON";
    var idx = S(id).strip("_ON", "_OFF").s;

    if (probes[id]) {
      str_hass = `{"Time":"${moment().format()}", "type": "probe"`;
      tags.forEach((tag) => {
        var value = S(msg).between("<" + tag + ">", "</" + tag + ">").s;

        if (value) {
          if (!isNaN(value)) {
            // test if value is a float or int
            try {
              value = parseFloat(value);
            } catch (e) {
              value = parseInt(value);
            }
          } else {
            value = `"${value}"`; //cannot convert to int or float then add double quotes
          }
          str_hass += `,"${tag}":${value}`;
        }
      });
      str_hass += "}";
      publish_hass(id, str_hass);
    } else if (sensors[idx]) {
      // Publish on stat hass
      str_hass = `{"Time":"${moment().format()}", "type": "sensor"`;
      if (state) {
        str_hass += `,"state":"${state}"`;
      }
      tags.forEach((tag) => {
        var value = S(msg).between("<" + tag + ">", "</" + tag + ">").s;
        if (value) {
          if (!isNaN(value)) {
            // test if value is a float or int
            try {
              value = parseFloat(value);
            } catch (e) {
              value = parseInt(value);
            }
          } else {
            value = `"${value}"`; // cannot convert to int or float then add double quotes
          }
          str_hass += `,"${tag}":${value}`;
        }
      });
      str_hass += "}";
      publish_hass(idx, str_hass);
    } else if (actuators[idx]) {
      msg = msg.replace(
        /<id>(.*)<\/id>/g,
        actuators[idx].name + " actuator ($1)"
      );
      logger.debug(msg);
    }
  }

  if (!debug) {
    msg = msg.replace(/<(?:.|\n)*?>/gm, ""); // delete all html tags
  }
}

b.fill(0);
b.write("ZSIG\0", 0 /*offset*/);
b.writeUInt16BE(8, 4); // command NOP (08) ZIBASE DISCOVERY
// Broadcast msg on lan to retrieve zibase IP
client.send(b, 0, b.length, 49999, "192.168.0.255", function (err, bytes) {
  logger.debug(b.toString());
});
server.bind(0x42cc, clientIp); //port 17100 is 0x42CC

process.on("SIGINT", function () {
  logger.info("Caught interrupt signal");
  // Callback for disconnection
  publishOnlineStatus(false);
  mqttclient.end(false);

  b.fill(0);
  b.write("ZSIG\0", 0 /*offset*/);
  b.writeUInt32BE(dot2num(clientIp), 50); //Ip address
  b.writeUInt32BE(0x42cc, 54); // port 17100 0x42CC
  b.writeUInt16BE(22, 4); //command HOST UNREGISTERING (22)
  logger.info(b.toString());
  logger.info("HOST UNREGISTERING sent to " + zibaseIp);
  client.send(b, 0, b.length, 49999, "192.168.0.255", function (err, bytes) {
    logger.info("Unregistering...", bytes);
    setTimeout(function () {
      logger.info("exit");
      client.close();
      process.exit();
    }, 1000);
  });
});

function dot2num(dot) {
  var d = dot.split(".");
  return ((+d[0] * 256 + +d[1]) * 256 + +d[2]) * 256 + +d[3];
}

function num2dot(num) {
  var d = num % 256;
  for (var i = 3; i > 0; i--) {
    num = Math.floor(num / 256);
    d = (num % 256) + "." + d;
  }
  return d;
}

function getIPAddress() {
  var interfaces = require("os").networkInterfaces();
  for (var devName in interfaces) {
    var iface = interfaces[devName];

    for (var i = 0; i < iface.length; i++) {
      var alias = iface[i];
      if (
        alias.family === "IPv4" &&
        alias.address !== "127.0.0.1" &&
        !alias.internal
      )
        return alias.address;
    }
  }

  return "0.0.0.0";
}
