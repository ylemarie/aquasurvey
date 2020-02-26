/*** INSTALL ***/
/*
	npm install jsonfile underscore express http socket.io ds18x20 dateformat onoff nodemailer
*/

/*** PARAMETERS ***/

//read parameters from json file
var jsonfile = require('jsonfile');
var _ = require("underscore");
var file = 'parameters.json';
var parameters = jsonfile.readFileSync(file);
function getParam( pname) {
	return _.find( parameters, {name: pname} ).value;
}
function getParamIdx( pname ) {
	return _.findIndex( parameters, {name: pname} );
}
function setParam( pname, newValue ) {
	parameters[ getParamIdx( pname ) ].value = newValue;
}
//populate "const"
var TEMP_EAU_MIN = getParam('TEMP_EAU_MIN');			// param01: Seuil T° eau mini
var TEMP_EAU_MAX = getParam('TEMP_EAU_MAX');			// param02: Seuil T° eau maxi
var TEMP_AIR_MIN = getParam('TEMP_AIR_MIN');			// param03: Seuil T° air mini
var TEMP_AIR_MAX = getParam('TEMP_AIR_MAX');			// param04: Seuil T° air maxi

var SENSOR_EAU_BAC = getParam('SENSOR_EAU_BAC');		// param05: Adresse Sonde eau bac
var SENSOR_EAU_DEC = getParam('SENSOR_EAU_DEC');		// param06: Adresse Sonde eau decant
var SENSOR_AIR_BAC = getParam('SENSOR_AIR_BAC');		// param07: Adresse Sonde air bac
var SENSOR_AIR_DEC = getParam('SENSOR_AIR_DEC');		// param08: Adresse Sonde air decant

var EMAIL_DEST = getParam('EMAIL_DEST');			// param09: Email alerte destinataire
var EMAIL_SERV = getParam('EMAIL_SERV');			// param10: smtp server
var EMAIL_SEND = getParam('EMAIL_SEND');			// param11: Temps entre 2 mails en minutes
var EMAIL_USER = getParam('EMAIL_USER');			// param12: smtp server user
var EMAIL_PASS = getParam('EMAIL_PASS');			// param13: smtp server pass

var CHECK_PERIOD = getParam('CHECK_PERIOD');			// param14: Check period in seconds
var SERVER_PORT  = getParam('SERVER_PORT');			// param15: Http port
var DEBUG 	 = getParam('DEBUG');				// param16: debug mode
var LOG 	 = getParam('LOG');				// param17: log mode

var GPIO_DECANT_MIN  = getParam('GPIO_DECANT_MIN');		// param18: Gpio Float Switch Decan Min
var GPIO_DECANT_MAX  = getParam('GPIO_DECANT_MAX');		// param19: Gpio Float Switch Decan Max
var GPIO_OSMOLATION  = getParam('GPIO_OSMOLATION');		// param20: Gpio Float Switch Osmolation Min
var GPIO_OSMOSEE     = getParam('GPIO_OSMOSEE');		// param21: Gpio Float Switch Osmosee Min
var GPIO_ECUMEUR_MIN = getParam('GPIO_ECUMEUR_MIN');		// param22: Gpio Induction Ecumeur Min
var GPIO_ECUMEUR_MAX = getParam('GPIO_ECUMEUR_MAX');		// param23: Gpio Induction Ecumeur Max

if (DEBUG) { 
	console.log("Nbr parameters:"+parameters.length); 
	console.log(parameters); 
}

/*** SERVER & SOCKET ***/

//Server & socket
var express = require('express');
app = express();
server = require('http').createServer(app);
io = require('socket.io').listen(server);
server.listen(SERVER_PORT);				//start server
app.use(express.static('public'));		//static page

/*** EMAIL ***/
const nodemailer = require('nodemailer');

// create reusable transporter object using the default SMTP transport
let transporter = nodemailer.createTransport({
    service: EMAIL_SERV,
    auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS
    }
});

/*** DATE ***/
var dateFormat = require('dateformat');				//https://github.com/felixge/node-dateformat

/*** GPIO ***/
var Gpio = require('onoff').Gpio; 					// Constructor function for Gpio objects. (need npm install rpio (?) & npm install onoff)
var decant_min	= new Gpio(GPIO_DECANT_MIN,  'in', 'both');
var decant_max	= new Gpio(GPIO_DECANT_MAX,  'in', 'both');
var osmolation 	= new Gpio(GPIO_OSMOLATION,  'in', 'both');
var osmosee 	= new Gpio(GPIO_OSMOSEE,     'in', 'both');
var ecumeur_min	= new Gpio(GPIO_ECUMEUR_MIN, 'in', 'both');
var ecumeur_max	= new Gpio(GPIO_ECUMEUR_MAX, 'in', 'both');

/*** TEMPERATURE ***/

var sensor = require('ds18x20');					//https://www.npmjs.com/package/ds18x20
sensor.loadDriver(function (err) {
    if (err) console.log('something went wrong loading the driver:', err)
    else console.log('driver is loaded');
});
var tempSensorsHard = sensor.list();
if (LOG) { console.log('T° Sensors Hardware Adr', tempSensorsHard); }
var tempSensors = [ SENSOR_EAU_BAC, SENSOR_EAU_DEC, SENSOR_AIR_BAC, SENSOR_AIR_DEC ];

//find missing hardcoded sensors
missing = false;
for (i=0; i<tempSensors.length; i++) {
	var found = false;
	for (j=0; j<tempSensorsHard.length; j++) {
		if ( tempSensors[i] == tempSensorsHard[j] ) {
			found = true;
			if (DEBUG) { console.log('FOUND   T° Sensors n°',i,' Adr', tempSensors[i]); }
		}
	}
	if ( !found ) {
		if (DEBUG) { console.log('MISSING T° Sensors n°',i,' Adr', tempSensors[i]); }
		tempSensors[i] = null;
		missing = true;
	}
}
//if (LOG) { console.log('T° Sensors Search Missing Adr', tempSensors); }

if ( missing == false ) {
	//read T°
	var allTempSensors = sensor.get(tempSensors);
	if (LOG) { console.log('All T°', allTempSensors); }
} else {
	if (LOG) { console.log('Missing sensors, can\'t read T°'); }
}

/*** Begin managing hardware *******************************************/

//manage Temperature Sensors
var getSensorTemp = function(sensorAdr) {
	if ( sensorAdr != null ) {
		temp = sensor.get(sensorAdr);
	} else {
		temp = 0;		//force 0
	}	
	if (DEBUG) {  console.log("T° of "+sensorAdr+"="+temp); }
	if (temp==false) 
		temp = 0;		//force 0
	return temp;
}

//manage web save parameters
function manageWebParametersSave(socket) {
	socket.on('save', function(data) {
		setParam( "TEMP_EAU_MIN", TEMP_EAU_MIN );
		setParam( "TEMP_EAU_MAX", TEMP_EAU_MAX );
		setParam( "TEMP_AIR_MIN", TEMP_AIR_MIN );
		setParam( "TEMP_AIR_MAX", TEMP_AIR_MAX );

		setParam( "SENSOR_EAU_BAC", SENSOR_EAU_BAC );
		setParam( "SENSOR_EAU_DEC", SENSOR_EAU_DEC );
		setParam( "SENSOR_AIR_BAC", SENSOR_AIR_BAC );
		setParam( "SENSOR_AIR_DEC", SENSOR_AIR_DEC );

		setParam( "GPIO_DECANT_MIN",  GPIO_DECANT_MIN );
		setParam( "GPIO_DECANT_MAX",  GPIO_DECANT_MAX );
		setParam( "GPIO_OSMOLATION",  GPIO_OSMOLATION );
		setParam( "GPIO_OSMOSEE",     GPIO_OSMOSEE );
		setParam( "GPIO_ECUMEUR_MIN", GPIO_ECUMEUR_MIN );
		setParam( "GPIO_ECUMEUR_MAX", GPIO_ECUMEUR_MAX );

		setParam( "EMAIL_DEST", EMAIL_DEST );
		setParam( "EMAIL_SERV", EMAIL_SERV );
		setParam( "EMAIL_SEND", EMAIL_SEND );
		setParam( "EMAIL_USER", EMAIL_USER );
		setParam( "EMAIL_PASS", EMAIL_PASS );

		setParam( "CHECK_PERIOD", CHECK_PERIOD );
		setParam( "SERVER_PORT", SERVER_PORT );
		setParam( "DEBUG", DEBUG );
		setParam( "LOG", LOG );
		jsonfile.writeFileSync(file, parameters);
		if (DEBUG) { console.log( jsonfile.readFileSync(file) ); }
	});
}
//manage parameters slider & socket
function manageWebParameters(socket, num) {
	var pName = 'param'+num;
	switch (num) {
		case 1  : paramValue = TEMP_EAU_MIN;	break;
		case 2  : paramValue = TEMP_EAU_MAX;	break;
		case 3  : paramValue = TEMP_AIR_MIN;	break;
		case 4  : paramValue = TEMP_AIR_MAX;	break;

		case 5  : paramValue = SENSOR_EAU_BAC;	break;
		case 6  : paramValue = SENSOR_EAU_DEC;	break;
		case 7  : paramValue = SENSOR_AIR_BAC;	break;
		case 8  : paramValue = SENSOR_AIR_DEC;	break;

		case 9  : paramValue = EMAIL_DEST;	break;
		case 10 : paramValue = EMAIL_SERV;	break;
		case 11 : paramValue = EMAIL_SEND;	break;
		case 12 : paramValue = EMAIL_USER;	break;
		case 13 : paramValue = EMAIL_PASS;	break;

		case 14 : paramValue = CHECK_PERIOD;	break;
		case 15 : paramValue = SERVER_PORT;	break;
		case 16 : paramValue = DEBUG;		break;
		case 17 : paramValue = LOG;		break;

		case 18 : paramValue = GPIO_DECANT_MIN;	 break;
		case 19 : paramValue = GPIO_DECANT_MAX;	 break;
		case 20 : paramValue = GPIO_OSMOLATION;	 break;
		case 21 : paramValue = GPIO_OSMOSEE;     break;
		case 22 : paramValue = GPIO_ECUMEUR_MIN; break;
		case 23 : paramValue = GPIO_ECUMEUR_MAX; break;

	}
	socket.on(pName, function(data) {
		paramValue = data.value;
		switch (num) {
			case 1  : TEMP_EAU_MIN = paramValue;	break;
			case 2  : TEMP_EAU_MAX = paramValue;	break;
			case 3  : TEMP_AIR_MIN = paramValue;	break;
			case 4  : TEMP_AIR_MAX = paramValue;	break;

			case 5  : SENSOR_EAU_BAC = paramValue;	break;
			case 6  : SENSOR_EAU_DEC = paramValue;	break;
			case 7  : SENSOR_AIR_BAC = paramValue;	break;
			case 8  : SENSOR_AIR_DEC = paramValue;	break;

			case 9  : EMAIL_DEST = paramValue;	break;
			case 10 : EMAIL_SERV = paramValue;	break;
			case 11 : EMAIL_SEND = paramValue;	break;
			case 12 : EMAIL_USER = paramValue;	break;
			case 13 : EMAIL_PASS = paramValue;	break;

			case 14 : CHECK_PERIOD = paramValue;	break;
			case 15 : SERVER_PORT = paramValue;	break;
			case 16 : DEBUG = paramValue;		break;
			case 17 : LOG = paramValue;		break;

			case 18 : GPIO_DECANT_MIN = paramValue;  break;
			case 19 : GPIO_DECANT_MAX = paramValue;	 break;
			case 20 : GPIO_OSMOLATION = paramValue;	 break;
			case 21 : GPIO_OSMOSEE = paramValue;	 break;
			case 22 : GPIO_ECUMEUR_MIN = paramValue; break;
			case 23 : GPIO_ECUMEUR_MAX = paramValue; break;
		}		
        if (DEBUG) { console.log(num+'-webPram) param='+paramValue); }
        //setParam(pName, paramValue);
		io.sockets.emit(pName, {value: paramValue});	
	});
	//if (LOG) { console.log(num+'-webParam-init) param='+paramValue); }
	//setParam(pName, paramValue);
	socket.emit(pName, {value: paramValue});
}

/*** BEGIN MAIN ***/
function manageWebInfos(socket) {
	var status = 0;				//status du systeme	0=OK
	var problem = [];

	var now = new Date();
	var now_hour = dateFormat(now, "HH:MM");

	var temp1_value = getSensorTemp( tempSensors[0] );
	var temp2_value = getSensorTemp( tempSensors[1] );
	var temp3_value = getSensorTemp( tempSensors[2] );
	var temp4_value = getSensorTemp( tempSensors[3] );
	var temp1_status = 0;
	var temp2_status = 0;
	var temp3_status = 0;
	var temp4_status = 0;

	if (temp1_value >= TEMP_EAU_MIN && temp1_value <= TEMP_EAU_MAX) { temp1_status = 0; }
	else {
		temp1_status = 1;
		if (temp1_value <= TEMP_EAU_MIN) { problem[status] = "Eau bac: "+temp1_value+"°C < "+TEMP_EAU_MIN+"°C"; }
		else { problem[status] = "Eau bac: "+temp1_value+"°C > "+TEMP_EAU_MAX+"°C"; }
		status++;
	}
	if (temp2_value >= TEMP_EAU_MIN && temp2_value <= TEMP_EAU_MAX) { temp2_status = 0; }
	else {
		temp2_status = 1;
		if (temp2_value <= TEMP_EAU_MIN) { problem[status] = "Eau decant: "+temp2_value+"°C < "+TEMP_EAU_MIN+"°C"; }
		else { problem[status] = "Eau decant: "+temp2_value+"°C > "+TEMP_EAU_MAX+"°C"; }
		status++;		
	}
	if (temp3_value >= TEMP_AIR_MIN && temp3_value <= TEMP_AIR_MAX) { temp3_status = 0; }
	else {
		temp3_status = 1;
		if (temp3_value <= TEMP_AIR_MIN) { problem[status] = "Air bac: "+temp3_value+"°C < "+TEMP_AIR_MIN+"°C"; }
		else { problem[status] = "Air bac: "+temp3_value+"°C > "+TEMP_AIR_MAX+"°C"; }
		status++;		
	}
	if (temp4_value >= TEMP_AIR_MIN && temp4_value <= TEMP_AIR_MAX) { temp4_status = 0; }
	else {
		temp4_status = 1;
		if (temp4_value <= TEMP_AIR_MIN) { problem[status] = "Air decant: "+temp4_value+"°C < "+TEMP_AIR_MIN+"°C"; }
		else { problem[status] = "Air decant: "+temp4_value+"°C > "+TEMP_AIR_MAX+"°C"; }
		status++;		
	}

	var decant_min_value = decant_min.readSync();
	var decant_max_value = decant_max.readSync();
	var osmolation_value = osmolation.readSync();
	var osmosee_value = osmosee.readSync();
	var ecumeur_min_value = ecumeur_min.readSync();
	var ecumeur_max_value = ecumeur_max.readSync();

	var decant_min_status = 0;
	var decant_max_status = 0;
	var osmolation_status = 0;
	var osmosee_status = 0;
	var ecumeur_min_status = 1;
	var ecumeur_max_status = 1;

	if (decant_min_value == 1) { decant_min_status = 0;}
	else {
		decant_min_status = 1;
		problem[status] = "Decant niveau mini";
		status++;
	}
	if (decant_max_value == 1) { decant_max_status = 0;}
	else {
		decant_max_status = 1;
		problem[status] = "Decant niveau maxi";
		status++;
	}
	if (osmolation_value == 1) { osmolation_status = 0;}
	else {
		osmolation_status = 1;
		problem[status] = "Osmolation niveau mini";
		status++;
	}
	if (osmosee_value == 1) { osmosee_status = 0;}
	else {
		osmosee_status = 1;
		problem[status] = "Osmosée niveau mini";
		status++;
	}
	if (ecumeur_min_value == 0) { ecumeur_min_status = 1;}
	else {
		ecumeur_min_status = 0;
		//pas grave problem[status] = "Ecumeur niveau mini";
		//pas grave status++;
	}
	if (ecumeur_max_value == 0) { ecumeur_max_status = 1;}
	else {
		ecumeur_max_status = 0;
		problem[status] = "Ecumeur niveau maxi";
		status++;
	}

	var infos_obj = {
		hour: now_hour,
		status: status,
		problem: problem,

		temp1: { value: temp1_value, status: temp1_status },
		temp2: { value: temp2_value, status: temp2_status },
		temp3: { value: temp3_value, status: temp3_status },
		temp4: { value: temp4_value, status: temp4_status },

		decant_min:	{ value: decant_min_value,  status: decant_min_status },
		decant_max:	{ value: decant_max_value,  status: decant_max_status },
		osmolation:	{ value: osmolation_value,  status: osmolation_status },
		osmosee:	{ value: osmosee_value,     status: osmosee_status },
		ecumeur_min:	{ value: ecumeur_min_value, status: ecumeur_min_status },
		ecumeur_max:	{ value: ecumeur_max_value, status: ecumeur_max_status }
	}
	socket.emit( 'aquasurvey', {infos:infos_obj} );

	return problem;
}

/*
for ( i=1; i <= parameters.length; i++ ) {
	manageWebParameters(io.sockets,i);
}
*/

var emailLastSent = Date.now();	//force 1er appel, resultat en milisecondes depuis 01/01/1970 ex 123456789

function sendEmail(problem) {
	var tempsEnMs = Date.now();	//ex 123987654 
	delai = (tempsEnMs-emailLastSent)/1000/60;	// en minutes
	if (delai < EMAIL_SEND) {
		if (DEBUG) console.log("Email not sent ["+delai+" < "+EMAIL_SEND+"]");
	} else {
		if (DEBUG) console.log("Email sent ["+delai+" >= "+EMAIL_SEND+"]");
		emailLastSent = Date.now();
		now_hour = dateFormat(emailLastSent, "yyyy-mm-dd HH:MM:ss");

		problem_txt = "Date:"+now_hour+"\nProblèmes:\n";
		problem_html = "<h4>Date:</h4><ul><li>"+now_hour+"</li></ul><h4>Problèmes:</h4><ul>";
		for (i=0; i<problem.length; i++) {
			problem_txt = problem_txt + "* " + problem[i] + "\n";
			problem_html = problem_html + "<li>" + problem[i] + "</li>";
		}
		problem_html = problem_html + "</ul>";

		let mailOptions = {
		    from: '"Aqua Survey" <'+EMAIL_USER+'>', 		// sender address
		    to: EMAIL_DEST, 								// list of receivers
		    subject: 'AquaSurvey Alarm ✔', 					// Subject line
		    text: problem_txt, 								// plain text body
		    html: problem_html		 						// html body
		};

		// send mail with defined transport object
		transporter.sendMail(mailOptions, (error, info) => {
		    if (error) {
		        return console.log(error);
		    }
		    if (DEBUG) console.log('Message %s sent: %s', info.messageId, info.response);
		});

	}
}

var check = function() {
	if (LOG) { console.log("Running every "+CHECK_PERIOD+" seconds"); }

	var problem = manageWebInfos(io.sockets);
	if (DEBUG) { console.log("Nbr problem:"+problem.length); }
	if (problem.length != 0) sendEmail(problem);

	for ( i=1; i <= parameters.length; i++ ) {
		manageWebParameters(io.sockets,i);
	}	
	manageWebParametersSave(io.sockets);
	
	clearInterval( interval );				//reinit CHECK_PERIOD if modified
	interval = setInterval( check, CHECK_PERIOD * 1000);	
}
var interval = setInterval( check, CHECK_PERIOD * 1000);

//on socket ready
io.sockets.on('connection', function (socket) {
	if (DEBUG) { console.log('Socket connection'); }

	problem = manageWebInfos(socket);
	if (problem.length != 0) sendEmail(problem);

	for ( i=1; i <= parameters.length; i++ ) {
		manageWebParameters(socket,i);
	}	
	manageWebParametersSave(socket);
});
if (DEBUG) { console.log("Running web on port %s",SERVER_PORT); }
//End main program--- -------------------------------------
