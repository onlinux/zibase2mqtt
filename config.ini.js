var config = {};

config.zibaseIp = process.env.IP_ZIBASE || '192.168.0.100'; // <- Enter LAN IP address
config.platform = 'localhost';
config.zibase = 'ZiBASE0059b5'; // <- Enter Main Identifier
config.token = 'xxxxxxx'; // <- Enter Token
config.url = 'http://' + config.platform + '/cgi-bin/decodetab?token=' + config.token;
config.debug = false;
config.env = 'development';
config.logfilename = 'zibase2mqtt.log';
config.mqtt_ip = '192.168.0.XX';
config.mqtt_topic_hass = 'zibase2mqtt';
config.mqtt_options = {
    keepalive: 60,
    username: 'user',
    password: 'password',
    port: 1883,
    clean: true,
    connectTimeout: 4000,
    reconnectPeriod: 15000,
    will: {
        topic: config.topic_hass + '/LWT',
        payload: 'Offline',
        qos: 0,
        retain: true
    }
};
// domoticz zibase id => domoticz id
config.ids = {
    'RTS433_C1': 80,
    'RTS433_C2': 78,
    'RTS433_C3': 79,
    'RTS433_C7': 47,
    'RTS433_C6': 48,
    'RTS433_C5': 49,
    'RTS433_C4': 50,
    'ZA3': 20,
    'ZA8': 35,
    'G2': 32,
    'G4': 68,
    'G5': 21,
    'G6': 19,
    'C10': 34,
    'B1': 142,
    'B2': 25,
    'B14': 26,
    'ZA4': 33,
    'ZA7': 36,
    'ZA10': 37,
    'ZA14': 46,
    'ZA15': 45,
    'B15': 38,
    'B13': 39,
    'E10': 40,
    'F10': 51,
    'CS889532848': 53,
    'C1': 52
};
module.exports = config;