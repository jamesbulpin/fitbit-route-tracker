import * as messaging from "messaging";
import document from "document";
import { display } from "display";

function renderUpdate(update) {
    if (update.pace) {
        var element = document.getElementById("ttglabel");
        if (element) {
            element.text = update.pace + "mins/km";
        }

        // Update pace chooser UI (even uf not currently visible)
        var currentPaceElementId = "pacerect" + update.pace.toString().replace(".", "_");
        var elements = document.getElementsByClassName("pacerectrect");
        elements.forEach((element) => {
            if (element.id == currentPaceElementId) {
                element.style.fill = "green";
            }
            else {
                element.style.fill = "black";
            }
        });
    
    }

    if ("route" in update) {
        var element = document.getElementById("route");
        if (element) {
            var txt = update.route || "-";
            if (txt.length > 20) {
                txt = txt.slice(0, 17) + "...";
            }
            element.text = txt;
        }
    }

    if ("ttg" in update) {
        var element = document.getElementById("ttg");
        if (element) {
            element.text = update.ttg || "-";
        }
    }

    if ("dtg" in update) {
        var element = document.getElementById("dtg");
        if (element) {
            element.text = update.dtg || "-";
        }
    }

    if ("eta" in update) {
        var element = document.getElementById("eta");
        if (element) {
            element.text = update.eta || "-";
        }
    }
}

function clearContent() {
    renderUpdate({
        route: null,
        ttg: null,
        dtg: null,
        eta: null
    });
}

function sendMessage(data) {
    if (messaging.peerSocket.readyState === messaging.peerSocket.OPEN) {
        messaging.peerSocket.send(data);
    }
    else {
        console.log("Cannot send update request - peer socket not ready");
    }
}

function requestUpdate() {
    var data = {
        command: "requestupdate"
    };
    sendMessage(data);
}

messaging.peerSocket.addEventListener("open", (_evt) => {
    console.log("Ready to send or receive messages");
    requestUpdate();
});

messaging.peerSocket.addEventListener("error", (err) => {
    console.error(`Connection error: ${err.code} - ${err.message}`);
});

messaging.peerSocket.addEventListener("message", (evt) => {
    console.error(JSON.stringify(evt.data));
    if (evt.data.command == "update") {
        renderUpdate(evt.data.payload);
    }
});

display.addEventListener("change", () => {
    if (display.on) {
        requestUpdate();
    }
});

function handleRouteClick(_evt) {
    console.log("handleRouteClick");
    sendMessage({command: "loadroute"});
}

function handleTtgClick(_evt) {
    console.log("handleTtgClick");
    document.getElementById("sectionmain").style.visibility = "hidden";
    document.getElementById("sectionpace").style.visibility = "visible";
}

function handlePaceRectClick(pace, _evt) {
    console.log("handlePaceRectClick", pace);
    clearContent();
    sendMessage({command: "setpace", payload: pace});
    document.getElementById("sectionmain").style.visibility = "visible";
    document.getElementById("sectionpace").style.visibility = "hidden";
}

document.getElementById("routerect").addEventListener("click", handleRouteClick);
document.getElementById("routelabel").addEventListener("click", handleRouteClick);
document.getElementById("route").addEventListener("click", handleRouteClick);

document.getElementById("ttgrect").addEventListener("click", handleTtgClick);
document.getElementById("ttg").addEventListener("click", handleTtgClick);
document.getElementById("ttglabel").addEventListener("click", handleTtgClick);
document.getElementById("ttglabel1").addEventListener("click", handleTtgClick);

document.getElementsByClassName("pacerectrect").forEach((element) => {
    element.addEventListener("click", handlePaceRectClick.bind(null, parseFloat(element.id.replace("pacerect", "").replace("_", "."))));
});

document.getElementsByClassName("pacetext").forEach((element) => {
    element.addEventListener("click", handlePaceRectClick.bind(null, parseFloat(element.id.replace("pacetext", "").replace("_", "."))));
});

console.log('Hello world!');
