import * as messaging from "messaging";
import { settingsStorage } from "settings";
import { localStorage } from "local-storage";
import { geolocation } from "geolocation";
import { me as companion } from "companion";
import calendars from "calendars";

const DEFAULT_PACE = 10.5;

var _activeRoute = null;
function getActiveRoute() {
    if (!_activeRoute) {
        var x = localStorage.getItem("activeroute");
        if (x) {
            console.log("Route loaded from local storage");
            _activeRoute = JSON.parse(x);
        }
    }
    return _activeRoute;
}

function getPace() {
    var s = settingsStorage.getItem("pace");
    if (s) {
        s = JSON.parse(s);
        if (s.values && (s.values.length > 0)) {
            if (s.values[0].name) {
                return parseFloat(s.values[0].name);
            }
        }
    }
    return DEFAULT_PACE;
}

function setPace(pace) {
    var x = {
        values: [
            {
                name: pace.toString()
            }
        ]
    };
    settingsStorage.setItem("pace", JSON.stringify(x));
    calculateProgress();
}

function getLastNearestWaypointIndex() {
    var x = localStorage.getItem("lastwpt");
    if (x) {
        return parseInt(x);
    }
    return null;
}

function setLastNearestWaypointIndex(idx) {
    if (idx === null) {
        localStorage.removeItem("lastwpt");
    }
    else {
        localStorage.setItem("lastwpt", idx.toString());
    }
}

function sendUpdate(progress) {
    if (messaging.peerSocket.readyState === messaging.peerSocket.OPEN) {
        var payload = {
            pace: getPace()
        };
        if (progress) {
            for (var k in progress) {
                payload[k] = progress[k];
            }
        }
        var data = {
            command: "update",
            payload
        };
        messaging.peerSocket.send(data);
    }
    else {
        console.log("Cannot send update - peer socket not ready");
    }
}

function distanceBetweenPoints(loca, locb) {
    // https://www.movable-type.co.uk/scripts/latlong.html
    const R = 6371000; // metres
    const phi1 = loca.lat * Math.PI/180; // phi, lambda in radians
    const phi2 = locb.lat * Math.PI/180;
    const deltaphi = (locb.lat-loca.lat) * Math.PI/180;
    const deltalambda = (locb.lon-loca.lon) * Math.PI/180;

    const a = Math.sin(deltaphi/2) * Math.sin(deltaphi/2) + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltalambda/2) * Math.sin(deltalambda/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const d = R * c; // in metres

    const lambda1 = loca.lon * Math.PI/180;
    const lambda2 = locb.lon * Math.PI/180;
    const y = Math.sin(lambda2-lambda1) * Math.cos(phi2);
    const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambda2-lambda1);
    const theta = Math.atan2(y, x);
    const brng = (theta*180/Math.PI + 360) % 360; // in degrees

    return {
        distance: d,
        bearing: brng
    };
}

function absBearingDifference(bearing1, bearing2) {
    var bearingDiff = Math.abs(bearing1 - bearing2);
    if (bearingDiff > 180) {
        bearingDiff = 360 - bearingDiff;
    }
    return bearingDiff;
}

function findNearestWaypointByList(route, loc, indicesToInclude) {
    var idx = null;
    var dist = null;
    var bearing = null;
    for (var i of indicesToInclude) {
        var d = distanceBetweenPoints(loc, route[i]);
        if ((dist === null) || (d.distance < dist)) {
            idx = i;
            dist = d.distance;
            bearing = d.bearing;
        }
    }
    return {
        index: idx,
        distance: dist,
        bearing: bearing,
        waypoint: route[idx]
    };
}

function findNearestWaypoint(route, loc, lastWaypointIndex) {
    // In scenarios where a route crosses itself and there are more than one
    // waypoints close together, favour waypoints close to where we are in sequence.
    var indicesNearbyInSequence = [];
    var otherIndices = [];

    for (var i = 0; i < route.length; i++) {
        if ((lastWaypointIndex !== null) && (Math.abs(i - lastWaypointIndex) <= 1)) {
            indicesNearbyInSequence.push(i);
        }
        else {
            otherIndices.push(i);
        }
    }

    var nearestOthers = findNearestWaypointByList(route, loc, otherIndices);
    if (indicesNearbyInSequence.length == 0) {
        return nearestOthers;
    }

    var nearestInSequence = findNearestWaypointByList(route, loc, indicesNearbyInSequence);

    console.log("Nearest in sequence:", nearestInSequence.index, nearestInSequence.distance);
    console.log("Nearest others:", nearestOthers.index, nearestOthers.distance);

    if (nearestInSequence.distance < nearestOthers.distance) {
        // The nearest in sequence is already nearest, so use that
        return nearestInSequence;
    }
    if ((nearestInSequence.distance - nearestOthers.distance) < 30) {
        // The nearest in sequence is within 30m of the other nearest, use the nearest in sequence
        console.log("Using waypoint " + nearestInSequence.index + " in preference to " + nearestOthers.index + " (30m rule)");
        return nearestInSequence;
    }
    if (((nearestInSequence.distance - nearestOthers.distance)/nearestInSequence.distance) < 0.1) {
        // The nearest in sequence is within 10% of the other nearest, use the nearest in sequence
        console.log("Using waypoint " + nearestInSequence.index + " in preference to " + nearestOthers.index + " (10% rule)");
        return nearestInSequence;
    }
    // Otherwise use the other nearest and assume we've shortcut the route or similar
    return nearestOthers;
}

function calculateProgress() {
    console.log("calculateProgress...")
    geolocation.getCurrentPosition(function(position) {
        console.log("Position", position.coords.latitude + ", " + position.coords.longitude);
        var currentPosition = {lat: position.coords.latitude, lon: position.coords.longitude};

        var activeRoute = getActiveRoute();
        var lastWaypointIndex = getLastNearestWaypointIndex();
        if (activeRoute && activeRoute.track) {

            // Find nearest waypoint in active route
            var nearest = findNearestWaypoint(activeRoute.track, currentPosition, lastWaypointIndex);
            console.log("Nearest", JSON.stringify(nearest));

            // Work out whether we're going to, or moving away from the current waypoint by
            // seeing if we're closer to a point on the preceeding or succeeding track
            // at the distance we're from the current waypoint.
            var approachingWptIdx = null;
            if (nearest.index == (activeRoute.track.length - 1)) {
                // Final waypoint, always measure to here
                approachingWptIdx = nearest.index;
                console.log("Approaching final waypoint");
            }
            else if (nearest.distance < 100) {
                // Too close to do any meaningful arithmetic, assume we're now heading to the next waypoint
                console.log("Within 100m of waypoint " + nearest.index);
                approachingWptIdx = nearest.index + 1;
            }
            else if (nearest.index == 0) {
                // The first waypoint - assume we're moving towards the first waypoint if our bearing from it is
                // in the opposite semicircle from the bearing from it to the second waypoint
                var bearingFromNearestToNext = null;
                if ("bearingToNext" in nearest.waypoint) {
                    bearingFromNearestToNext = nearest.waypoint.bearingToNext;
                }
                else {
                    console.warn("No precalculated bearing for waypoint " + nearest.index);
                    bearingFromNearestToNext = distanceBetweenPoints(nearest.waypoint, activeRoute.track[nearest.index + 1]).bearing;
                    nearest.waypoint.bearingToNext = bearingFromNearestToNext;
                }

                var bearingDiff = absBearingDifference(bearingFromNearestToNext, nearest.bearing);
                if (bearingDiff > 90) {
                    console.log("Leaving first waypoint");
                    approachingWptIdx = 1;
                }
                else {
                    console.log("Approaching first waypoint");
                    approachingWptIdx = 0;
                }
            }
            else {
                // Are we moving towards or away from the nearest waypoint? Compare the bearing from the nearest
                // waypoint to us, to the bear from it to the succeeding and preceeding waypoints. We're on the
                // side closed to that bearing
                var bearingNearestToUs = nearest.bearing - 180;
                if (bearingNearestToUs < 0) {
                    bearingNearestToUs += 360;
                }

                var bearingFromNearestToNext = null;
                if ("bearingToNext" in nearest.waypoint) {
                    bearingFromNearestToNext = nearest.waypoint.bearingToNext;
                }
                else {
                    console.warn("No precalculated bearing for waypoint " + nearest.index);
                    bearingFromNearestToNext = distanceBetweenPoints(nearest.waypoint, activeRoute.track[nearest.index + 1]).bearing;
                    nearest.waypoint.bearingToNext = bearingFromNearestToNext;
                }

                var bearingFromLastToNearest = null;
                if ("bearingToNext" in activeRoute.track[nearest.index - 1]) {
                    bearingFromLastToNearest = activeRoute.track[nearest.index - 1].bearingToNext;
                }
                else {
                    console.warn("No precalculated bearing for waypoint " + (nearest.index - 1));
                    bearingFromLastToNearest = distanceBetweenPoints(activeRoute.track[nearest.index - 1], nearest.waypoint).bearing;
                    activeRoute.track[nearest.index - 1].bearingToNext = bearingFromLastToNearest;
                }

                var bearingFromNearestToLast = bearingFromLastToNearest - 180;
                if (bearingFromNearestToLast < 0) {
                    bearingFromNearestToLast += 360;
                }

                var bearingDiffNext = absBearingDifference(bearingFromNearestToNext, bearingNearestToUs);
                var bearingDiffLast = absBearingDifference(bearingFromNearestToLast, bearingNearestToUs);
                if (bearingDiffNext < bearingDiffLast) {
                    console.log("Leaving waypoint " + nearest.index);
                    approachingWptIdx = nearest.index + 1;
                }
                else {
                    console.log("Approaching waypoint " + nearest.index);
                    approachingWptIdx = nearest.index;
                }
            }

            // Determine how far (direct line) we are from the next waypoint (which may be
            // closest or its successor depending on the above).
            // Add this to the total remaining distance between all future waypoints
            var dtgm = 0;
            dtgm += distanceBetweenPoints(currentPosition, activeRoute.track[approachingWptIdx]).distance;
            if ("remainingDistance" in activeRoute.track[approachingWptIdx]) {
                dtgm += activeRoute.track[approachingWptIdx].remainingDistance;
            }
            else {
                console.warn("No precalculated remaining distance for waypoint " + approachingWptIdx);
                var remainingDistance = 0;
                for (var i = approachingWptIdx; i < (activeRoute.track.length - 1); i++) {
                    var a2b = distanceBetweenPoints(activeRoute.track[i], activeRoute.track[i+1]);
                    console.log("Remaining segment " + i + "->" + (i+1) + " " + a2b.distance + "m");
                    remainingDistance += a2b.distance;
                }
                activeRoute.track[approachingWptIdx].remainingDistance = remainingDistance;
                dtgm += remainingDistance;
            }

            var dtg = "";
            if (dtgm < 1000) {
                dtg = Math.round(dtgm) + "m";
            }
            else if (dtgm < 10000) {
                dtg = Math.floor(dtgm/1000) + "." + ("0"+Math.floor((dtgm%1000)/10)).substr(-2) + "km";
            }
            else if (dtgm < 100000) {
                dtg = Math.floor(dtgm/1000) + "." + Math.floor((dtgm%1000)/100) + "km";
            }
            else {
                dtg = Math.round(dtgm/1000) + "km";
            }

            var pace = getPace();
            var ttgm = Math.round(dtgm * pace / 1000);
            var ttg = "";
            if (ttgm == 1) {
                ttg = "1 min";
            }
            else if (ttgm < 60) {
                ttg = Math.round(ttgm) + " mins";
            }
            else {
                ttg = Math.floor(ttgm/60) + "h" + ("0"+Math.floor(ttgm%60)).slice(-2);
            }

            var etad = new Date().getTime();
            etad += ttgm * 60 * 1000;
            var eta = new Date(etad).toTimeString().slice(0, 5);

            if (lastWaypointIndex !== nearest.index) {
                setLastNearestWaypointIndex(nearest.index);
            }

            sendUpdate({
                route: activeRoute.name || "(unnamed)",
                dtg,
                ttg,
                eta
            });
        }
        else {
            sendUpdate({
                route: null,
                ttg: null,
                dtg: null,
                eta: null
            });
        }
    },
    function(err) {
        console.error("getCurrentPosition() error", err.message);
    });
}

function parseGPX(gpx) {
    // In case this is an HTMLified GPX
    gpx = gpx.replace(/\&gt;/g, ">");
    gpx = gpx.replace(/\&lt;/g, "<");

    var route = {
        name: null,
        track: []
    };

    // Very simplified parsing...
    var m = gpx.match(/\<name\>(.*?)\<\/name>/);
    if (m && (m.length > 1) && m[1]) {
        route.name = m[1]
    }

    var mx = gpx.matchAll(/\<trkpt\s+lat=\"([0-9\.]+)\"\s+lon=\"([0-9\.]+)\"\s*\/\>/g);
    for (var m of mx) {
        if (m && (m.length > 2) && m[1] && m[2]) {
            var lat = parseFloat(m[1]);
            var lon = parseFloat(m[2]);
            route.track.push({lat, lon});
        }
    }

    return route;
}

function precalculateRoute(route) {
    var accumulator = 0;
    if (route && route.track && (route.track.length > 1)) {
        for (var i = route.track.length - 2; i >= 0; i--) {
            var a2b = distanceBetweenPoints(route.track[i], route.track[i+1]);
            accumulator += a2b.distance;
            route.track[i].distanceToNext = a2b.distance;
            route.track[i].bearingToNext = a2b.bearing;
            route.track[i].remainingDistance = accumulator;
        }
        route.track[route.track.length - 1].remainingDistance = 0;
    }
}

function getRouteFromCalendar() {
    return new Promise((resolve, reject) => {
        let start = new Date()
        start.setHours(0, 0, 0, 0)
        let end = new Date()
        end.setHours(23, 59, 59, 999)

        let eventsQuery = { startDate: start, endDate: end }

        calendars.searchEvents(eventsQuery).then(function(todayEvents) {
            console.log("Calendar search returned " + todayEvents.length + " event(s)");
            var error = null;
            var found = null;
            todayEvents.forEach(event => {
                console.log(event.title);
                if (event.title == "Route") {
                    console.log("Found route event in calendar");
                    //console.log(JSON.stringify(event));
                    //console.log(event.description);
                    if (event.description) {
                        var route = parseGPX(event.description);
                        if (route.track.length == 0) {
                            console.log("Could not parse route from GPX");
                            error = "Could not parse route from GPX";
                        }
                        else {
                            precalculateRoute(route);
                            console.log(JSON.stringify(route, null, 2));
                            found = route;
                            error = null;
                        }
                    }
                    else {
                        console.log("No description found for Route entry in calendar");
                        error = "No description found for Route entry in calendar";
                    }
                }
            });
            if (error) {
                reject(error);
            }
            else {
                resolve(found);
            }
        });
    });
}

messaging.peerSocket.addEventListener("open", (_evt) => {
    console.log("Ready to send or receive messages");
});

messaging.peerSocket.addEventListener("error", (err) => {
    console.error(`Connection error: ${err.code} - ${err.message}`);
});

messaging.peerSocket.addEventListener("message", (evt) => {
    console.error(JSON.stringify(evt.data));
    switch (evt.data.command) {
    case "requestupdate":
        calculateProgress();
        break;
    case "loadroute":
        getRouteFromCalendar().then(found => {
            if (found) {
                localStorage.setItem("activeroute", JSON.stringify(found));
                setLastNearestWaypointIndex(0);
                _activeRoute = found;
                calculateProgress();
            }
        }).catch(console.error);
        break;
    case "setpace":
        setPace(evt.data.payload);
        break;
    }
});

settingsStorage.addEventListener("change", (evt) => {
    console.log("Settings changed: " + JSON.stringify(evt));
    if (evt.key == "pace") {
        calculateProgress();
    }
});

if (!companion.permissions.granted("access_location")) {
    console.log("We're not allowed to access device location!");
}
if (!companion.permissions.granted("run_background")) {
    console.log("We're not allowed to run in the background!");
}

console.log('Hello world!');
