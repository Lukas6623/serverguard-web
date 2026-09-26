"use strict";


/* ============================================================
   SERVERGUARD CORE
   ============================================================ */

window.ServerGuard = (function ()
{

const $ = id =>
    document.getElementById(id);



/* ============================================================
   API QUEUE
   ============================================================ */

let chain = Promise.resolve();


function api(path, method = "GET")
{

    const run = () =>

        fetch(
            path,
            {
                method
            }
        )

        .then(
            async r =>
            {

                let d = {};

                try
                {
                    d = await r.json();
                }
                catch (e)
                {
                }

                return {
                    ok: r.ok,
                    status: r.status,
                    data: d
                };

            }
        );


    const p =
        chain.then(run);


    chain =
        p.catch(() =>
        {
        });


    return p;
}



/* ============================================================
   BUSY
   ============================================================ */

let busy = false;

const busyListeners = [];


function setBusy(v)
{

    busy = v;

    document.body.classList.toggle(
        "busy",
        v
    );


    busyListeners.forEach(
        fn => fn()
    );

}


function isBusy()
{
    return busy;
}



/* ============================================================
   BANNER
   ============================================================ */

function banner(msg)
{

    const b =
        $("banner");


    if (!b)
        return;


    b.textContent =
        msg || "";


    b.classList.toggle(
        "show",
        !!msg
    );

}



/* ============================================================
   LOGGER
   ============================================================ */

function createLogger(ulId)
{

    return function (text, ok)
    {

        const ul =
            $(ulId);


        if (!ul)
            return;


        if (
            ul.querySelector(".sub")
        )
        {
            ul.innerHTML = "";
        }


        const li =
            document.createElement(
                "li"
            );


        const t =
            document.createElement(
                "time"
            );


        t.textContent =
            new Date()
                .toLocaleTimeString();


        const s =
            document.createElement(
                "span"
            );


        s.textContent =
            text;


        s.className =
            ok
                ? "ok"
                : "bad";


        li.append(
            t,
            s
        );


        ul.prepend(
            li
        );

    };

}



/* ============================================================
   CONFIRM DIALOG
   ============================================================ */

function ask(title, text)
{

    return new Promise(
        res =>
        {

            const dialog =
                $("dlg");


            if (!dialog)
            {
                res(false);
                return;
            }


            $("dlgTitle").textContent =
                title;


            $("dlgText").textContent =
                text;


            dialog.showModal();


            const done =
                value =>
                {

                    dialog.close();


                    $("dlgYes").onclick =
                        null;


                    $("dlgNo").onclick =
                        null;


                    res(value);

                };


            $("dlgYes").onclick =
                () =>
                    done(true);


            $("dlgNo").onclick =
                () =>
                    done(false);


            dialog.oncancel =
                () =>
                    done(false);

        }
    );

}



/* ============================================================
   MODULE MANIFEST
   ============================================================ */

const MODULE_MANIFEST =
[
    {
        id: "sshkeys",
        name: "SSH Key Guard"
    },

    {
        id: "security",
        name: "Security"
    },

    {
        id: "telegram",
        name: "Telegram Bot"
    },

    {
        id: "hardening",
        name: "SSH Hardening"
    },

    {
        id: "fileguard",
        name: "FileGuard"
    }
];



/* ============================================================
   MODULE REGISTRY
   ============================================================ */

const registry = {};


function registerModule(
    id,
    impl
)
{

    registry[id] =
        impl || {};


    if (
        impl &&
        impl.onBusyChange
    )
    {

        busyListeners.push(
            impl.onBusyChange
        );

    }


    if (
        impl &&
        impl.autoRefresh
    )
    {

        const {
            checkboxId,
            intervalMs,
            fn
        } =
            impl.autoRefresh;


        setInterval(
            () =>
            {

                const box =
                    $(checkboxId);


                if (

                    box &&

                    box.checked &&

                    !document.hidden &&

                    currentModule === id

                )
                {

                    fn();

                }

            },

            intervalMs || 15000

        );

    }

}



/* ============================================================
   NAVIGATION
   ============================================================ */

let moduleState = {};


let currentModule =
    "overview";


function renderNav()
{

    const nav =
        $("nav");


    if (!nav)
        return;


    nav.innerHTML = "";


    /* HOME */

    const home =
        document.createElement(
            "button"
        );


    home.className =
        currentModule === "overview"
            ? "active"
            : "";


    home.innerHTML =
        "<span>Global Overview</span><small>live</small>";


    home.onclick =
        () =>
        {

            currentModule =
                "overview";


            showModule();

            renderNav();

        };


    nav.append(
        home
    );



    /* MODULES */

    MODULE_MANIFEST.forEach(
        m =>
        {

            const sectionPresent =

                !!document.querySelector(
                    'section[data-module="' +
                    m.id +
                    '"]'
                );


            const ready =

                !!moduleState[m.id] &&
                sectionPresent;


            const b =
                document.createElement(
                    "button"
                );


            b.disabled =
                !ready;


            b.className =

                m.id === currentModule
                    ? "active"
                    : "";


            b.innerHTML =
                "<span>" +
                m.name +
                "</span>" +
                "<small></small>";


            b.lastChild.textContent =
                ready
                    ? ""
                    : "скоро";


            b.onclick =
                () =>
                {

                    currentModule =
                        m.id;


                    showModule();

                    renderNav();


                    const impl =
                        registry[m.id];


                    if (
                        impl &&
                        impl.onShow
                    )
                    {

                        impl.onShow();

                    }

                };


            nav.append(
                b
            );

        }
    );

}



function showModule()
{

    document
        .querySelectorAll(
            "[data-module]"
        )
        .forEach(
            section =>
            {

                section.hidden =
                    section.dataset.module !==
                    currentModule;

            }
        );

}



/* ============================================================
   HEALTH CHECK
   ============================================================ */

async function checkHealth()
{

    try
    {

        const r =
            await fetch(
                "/api/health"
            );


        if (
            r.status === 401
        )
        {

            $("connDot")
                .className =
                "dot off";


            $("connText")
                .textContent =
                "нет доступа";


            banner(
                "Нет доступа. Откройте ссылку с токеном из консоли ServerGuard."
            );


            return null;

        }


        const d =
            await r.json();


        $("connDot")
            .className =
            "dot on";


        $("connText")
            .textContent =
            "ServerGuard онлайн";


        banner("");


        return d;

    }
    catch (e)
    {

        $("connDot")
            .className =
            "dot off";


        $("connText")
            .textContent =
            "нет связи";


        banner(
            "Нет связи с ServerGuard. Убедитесь, что программа запущена и SSH-сессия открыта."
        );


        return null;

    }

}



/* ============================================================
   MODULE STATE
   ============================================================ */

async function loadModuleState()
{

    try
    {

        const r =
            await fetch(
                "/api/modules"
            );


        if (!r.ok)
            throw new Error(
                "HTTP " +
                r.status
            );


        moduleState =
            await r.json();

    }
    catch (e)
    {

        moduleState = {};

    }


    renderNav();

}



/* ============================================================
   MODULE ASSETS
   ============================================================ */

function loadStylesheet(href)
{

    return new Promise(
        resolve =>
        {

            const link =
                document.createElement(
                    "link"
                );


            link.rel =
                "stylesheet";


            link.href =
                href;


            link.onload =
                resolve;


            link.onerror =
                resolve;


            document.head.append(
                link
            );

        }
    );

}



async function loadHtml(
    href,
    mount
)
{

    const r =
        await fetch(
            href
        );


    if (!r.ok)
    {

        throw new Error(
            "Не удалось загрузить " +
            href +
            " (HTTP " +
            r.status +
            ")"
        );

    }


    const html =
        await r.text();


    mount.insertAdjacentHTML(
        "beforeend",
        html
    );

}



function loadScript(src)
{

    return new Promise(
        (resolve, reject) =>
        {

            const s =
                document.createElement(
                    "script"
                );


            s.src =
                src;


            s.onload =
                resolve;


            s.onerror =
                () =>
                    reject(
                        new Error(
                            "Не удалось загрузить " +
                            src
                        )
                    );


            document.body.append(
                s
            );

        }
    );

}



async function loadModuleAssets(id)
{

    const base =
        "modules/" +
        id +
        "/";


    await loadStylesheet(
        base +
        "style.css"
    );


    await loadHtml(
        base +
        "index.html",
        $("main")
    );


    await loadScript(
        base +
        "script.js"
    );

}



/* ============================================================
   GLOBAL WORLD
   ============================================================ */

function initWorld()
{

    const canvas =
        $("worldCanvas");


    if (!canvas)
        return;


    const ctx =
        canvas.getContext(
            "2d"
        );


    if (!ctx)
        return;



    /* ========================================================
       WORLD DATA
       ======================================================== */

    const nodes =
    [

        {
            city:"Kyiv",
            country:"Ukraine",
            lat:50.4501,
            lon:30.5234,
            color:0
        },

        {
            city:"Frankfurt",
            country:"Germany",
            lat:50.1109,
            lon:8.6821,
            color:1
        },

        {
            city:"Warsaw",
            country:"Poland",
            lat:52.2297,
            lon:21.0122,
            color:0
        },

        {
            city:"London",
            country:"United Kingdom",
            lat:51.5074,
            lon:-0.1278,
            color:1
        },

        {
            city:"New York",
            country:"USA",
            lat:40.7128,
            lon:-74.0060,
            color:0
        },

        {
            city:"Toronto",
            country:"Canada",
            lat:43.6532,
            lon:-79.3832,
            color:1
        },

        {
            city:"Singapore",
            country:"Singapore",
            lat:1.3521,
            lon:103.8198,
            color:0
        },

        {
            city:"Tokyo",
            country:"Japan",
            lat:35.6762,
            lon:139.6503,
            color:1
        },

        {
            city:"Istanbul",
            country:"Turkey",
            lat:41.0082,
            lon:28.9784,
            color:0
        },

        {
            city:"Dubai",
            country:"UAE",
            lat:25.2048,
            lon:55.2708,
            color:1
        },

        {
            city:"Sydney",
            country:"Australia",
            lat:-33.8688,
            lon:151.2093,
            color:0
        },

        {
            city:"São Paulo",
            country:"Brazil",
            lat:-23.5505,
            lon:-46.6333,
            color:1
        }

    ];



    const links =
    [

        [0,1],
        [0,2],
        [0,8],
        [1,3],
        [1,4],
        [2,3],
        [3,4],
        [4,5],
        [4,11],
        [5,6],
        [6,7],
        [7,10],
        [8,9],
        [9,6],
        [9,10],
        [10,7],
        [11,4]

    ];



    /* ========================================================
       STARS
       ======================================================== */

    const stars = [];


    for (
        let i = 0;
        i < 260;
        i++
    )
    {

        stars.push(
            {
                x:Math.random(),
                y:Math.random(),
                r:
                    Math.random() *
                    1.5 +
                    .2,

                a:
                    Math.random() *
                    .55 +
                    .1,

                tw:
                    Math.random() *
                    Math.PI *
                    2

            }
        );

    }



    /* ========================================================
       PARTICLES
       ======================================================== */

    const particles =
        [];


    for (
        let i = 0;
        i < 70;
        i++
    )
    {

        const link =
            links[
                Math.floor(
                    Math.random() *
                    links.length
                )
            ];


        particles.push(
            {
                link,
                progress:
                    Math.random(),

                speed:
                    .0008 +
                    Math.random() *
                    .0015

            }
        );

    }



    let rotation = 0;

    let mouseX = 0;

    let mouseY = 0;

    let hoveredNode = -1;



    /* ========================================================
       RESIZE
       ======================================================== */

    function resize()
    {

        const rect =
            canvas.getBoundingClientRect();


        const dpr =
            Math.min(
                window.devicePixelRatio ||
                1,
                2
            );


        canvas.width =
            rect.width *
            dpr;


        canvas.height =
            rect.height *
            dpr;


        ctx.setTransform(
            dpr,
            0,
            0,
            dpr,
            0,
            0
        );

    }


    window.addEventListener(
        "resize",
        resize
    );


    resize();



    /* ========================================================
       PROJECTION
       ======================================================== */

    function project(
        lat,
        lon,
        cx,
        cy,
        radius
    )
    {

        const phi =
            lat *
            Math.PI /
            180;


        const lambda =
            (
                lon +
                rotation
            ) *
            Math.PI /
            180;


        const x =
            Math.cos(phi) *
            Math.sin(lambda);


        const y =
            Math.sin(phi);


        const z =
            Math.cos(phi) *
            Math.cos(lambda);


        return {

            x:
                cx +
                radius *
                x,

            y:
                cy -
                radius *
                y,

            z

        };

    }



    /* ========================================================
       GREAT CIRCLE
       ======================================================== */

    function drawLink(
        a,
        b,
        cx,
        cy,
        radius
    )
    {

        const steps = 42;


        const pa =
            nodes[a];


        const pb =
            nodes[b];


        const points = [];


        for (
            let i = 0;
            i <= steps;
            i++
        )
        {

            const t =
                i /
                steps;


            const lat =
                pa.lat +
                (
                    pb.lat -
                    pa.lat
                ) *
                t;


            const lon =
                pa.lon +
                (
                    pb.lon -
                    pa.lon
                ) *
                t;


            const p =
                project(
                    lat,
                    lon,
                    cx,
                    cy,
                    radius
                );


            points.push(p);

        }


        ctx.beginPath();


        let started =
            false;


        for (
            const p of points
        )
        {

            if (p.z < -.05)
            {
                started = false;
                continue;
            }


            if (!started)
            {

                ctx.moveTo(
                    p.x,
                    p.y
                );

                started = true;

            }
            else
            {

                ctx.lineTo(
                    p.x,
                    p.y
                );

            }

        }


        ctx.strokeStyle =
            "rgba(81,230,255,.16)";


        ctx.lineWidth =
            1;


        ctx.stroke();


        return points;

    }



    /* ========================================================
       DRAW PLANET
       ======================================================== */

    function drawPlanet(
        time
    )
    {

        const rect =
            canvas.getBoundingClientRect();


        const width =
            rect.width;


        const height =
            rect.height;


        const cx =
            width / 2;


        const cy =
            height / 2;


        const radius =
            Math.min(
                width,
                height
            ) *
            .32;



        /* stars */

        for (
            const star of stars
        )
        {

            const alpha =
                star.a +
                Math.sin(
                    time *
                    .001 +
                    star.tw
                ) *
                .12;


            ctx.fillStyle =
                "rgba(150,210,255," +
                alpha +
                ")";


            ctx.beginPath();


            ctx.arc(
                star.x *
                    width,

                star.y *
                    height,

                star.r,

                0,
                Math.PI * 2
            );


            ctx.fill();

        }



        /* outer glow */

        const glow =
            ctx.createRadialGradient(
                cx,
                cy,
                radius * .55,
                cx,
                cy,
                radius * 1.2
            );


        glow.addColorStop(
            0,
            "rgba(20,90,140,.12)"
        );


        glow.addColorStop(
            .72,
            "rgba(20,130,180,.04)"
        );


        glow.addColorStop(
            1,
            "rgba(0,0,0,0)"
        );


        ctx.fillStyle =
            glow;


        ctx.beginPath();


        ctx.arc(
            cx,
            cy,
            radius * 1.3,
            0,
            Math.PI * 2
        );


        ctx.fill();



        /* planet */

        const planet =
            ctx.createRadialGradient(
                cx -
                    radius * .25,

                cy -
                    radius * .25,

                radius * .05,

                cx,
                cy,
                radius
            );


        planet.addColorStop(
            0,
            "#102d40"
        );


        planet.addColorStop(
            .45,
            "#091d2d"
        );


        planet.addColorStop(
            .8,
            "#06131f"
        );


        planet.addColorStop(
            1,
            "#02070d"
        );


        ctx.fillStyle =
            planet;


        ctx.beginPath();


        ctx.arc(
            cx,
            cy,
            radius,
            0,
            Math.PI * 2
        );


        ctx.fill();



        /* latitude */

        ctx.save();


        ctx.beginPath();


        ctx.arc(
            cx,
            cy,
            radius,
            0,
            Math.PI * 2
        );


        ctx.clip();


        for (
            let lat = -60;
            lat <= 60;
            lat += 20
        )
        {

            ctx.beginPath();


            for (
                let lon = -180;
                lon <= 180;
                lon += 5
            )
            {

                const p =
                    project(
                        lat,
                        lon,
                        cx,
                        cy,
                        radius
                    );


                if (
                    lon === -180
                )
                {

                    ctx.moveTo(
                        p.x,
                        p.y
                    );

                }
                else
                {

                    ctx.lineTo(
                        p.x,
                        p.y
                    );

                }

            }


            ctx.strokeStyle =
                "rgba(65,150,190,.09)";


            ctx.lineWidth =
                .7;


            ctx.stroke();

        }



        /* longitude */

        for (
            let lon = -180;
            lon < 180;
            lon += 20
        )
        {

            ctx.beginPath();


            for (
                let lat = -90;
                lat <= 90;
                lat += 5
            )
            {

                const p =
                    project(
                        lat,
                        lon,
                        cx,
                        cy,
                        radius
                    );


                if (
                    lat === -90
                )
                {

                    ctx.moveTo(
                        p.x,
                        p.y
                    );

                }
                else
                {

                    ctx.lineTo(
                        p.x,
                        p.y
                    );

                }

            }


            ctx.strokeStyle =
                "rgba(65,150,190,.08)";


            ctx.lineWidth =
                .7;


            ctx.stroke();

        }


        ctx.restore();



        /* links */

        for (
            const link of links
        )
        {

            drawLink(
                link[0],
                link[1],
                cx,
                cy,
                radius
            );

        }



        /* particles */

        for (
            const particle of particles
        )
        {

            particle.progress +=
                particle.speed;


            if (
                particle.progress > 1
            )
            {

                particle.progress =
                    0;

            }


            const a =
                nodes[
                    particle.link[0]
                ];


            const b =
                nodes[
                    particle.link[1]
                ];


            const t =
                particle.progress;


            const lat =
                a.lat +
                (
                    b.lat -
                    a.lat
                ) *
                t;


            const lon =
                a.lon +
                (
                    b.lon -
                    a.lon
                ) *
                t;


            const p =
                project(
                    lat,
                    lon,
                    cx,
                    cy,
                    radius
                );


            if (
                p.z > .05
            )
            {

                ctx.beginPath();


                ctx.arc(
                    p.x,
                    p.y,
                    2.1,
                    0,
                    Math.PI * 2
                );


                ctx.fillStyle =
                    "#73f3ff";


                ctx.shadowColor =
                    "#51e6ff";


                ctx.shadowBlur =
                    13;


                ctx.fill();


                ctx.shadowBlur =
                    0;

            }

        }



        /* nodes */

        hoveredNode = -1;


        nodes.forEach(
            (node,index) =>
            {

                const p =
                    project(
                        node.lat,
                        node.lon,
                        cx,
                        cy,
                        radius
                    );


                if (
                    p.z < .05
                )
                    return;


                const pulse =
                    1 +
                    Math.sin(
                        time *
                        .003 +
                        index
                    ) *
                    .35;


                const nodeRadius =
                    3 *
                    pulse;


                /* glow */

                ctx.beginPath();


                ctx.arc(
                    p.x,
                    p.y,
                    nodeRadius * 3,
                    0,
                    Math.PI * 2
                );


                ctx.fillStyle =
                    node.color === 0

                        ? "rgba(67,245,173,.07)"

                        : "rgba(81,230,255,.07)";


                ctx.fill();



                ctx.beginPath();


                ctx.arc(
                    p.x,
                    p.y,
                    nodeRadius,
                    0,
                    Math.PI * 2
                );


                ctx.fillStyle =
                    node.color === 0
                        ? "#43f5ad"
                        : "#51e6ff";


                ctx.shadowColor =
                    ctx.fillStyle;


                ctx.shadowBlur =
                    15;


                ctx.fill();


                ctx.shadowBlur =
                    0;



                /* ring */

                ctx.beginPath();


                ctx.arc(
                    p.x,
                    p.y,
                    7 +
                    Math.sin(
                        time * .002 +
                        index
                    ) *
                    2,

                    0,
                    Math.PI * 2
                );


                ctx.strokeStyle =
                    node.color === 0
                        ? "rgba(67,245,173,.2)"
                        : "rgba(81,230,255,.2)";


                ctx.lineWidth =
                    .7;


                ctx.stroke();



                const dx =
                    mouseX -
                    p.x;


                const dy =
                    mouseY -
                    p.y;


                if (
                    dx * dx +
                    dy * dy <
                    13 * 13
                )
                {

                    hoveredNode =
                        index;

                }

            }
        );



        /* border */

        ctx.beginPath();


        ctx.arc(
            cx,
            cy,
            radius,
            0,
            Math.PI * 2
        );


        ctx.strokeStyle =
            "rgba(81,230,255,.28)";


        ctx.lineWidth =
            1.2;


        ctx.stroke();



        /* atmosphere */

        const atmosphere =
            ctx.createRadialGradient(
                cx,
                cy,
                radius * .85,
                cx,
                cy,
                radius * 1.07
            );


        atmosphere.addColorStop(
            0,
            "rgba(81,230,255,0)"
        );


        atmosphere.addColorStop(
            .78,
            "rgba(81,230,255,.03)"
        );


        atmosphere.addColorStop(
            1,
            "rgba(81,230,255,.16)"
        );


        ctx.fillStyle =
            atmosphere;


        ctx.beginPath();


        ctx.arc(
            cx,
            cy,
            radius * 1.07,
            0,
            Math.PI * 2
        );


        ctx.fill();



        /* rotation */

        rotation +=
            .012;

    }



    /* ========================================================
       MOUSE
       ======================================================== */

    canvas.addEventListener(
        "mousemove",
        event =>
        {

            const rect =
                canvas.getBoundingClientRect();


            mouseX =
                event.clientX -
                rect.left;


            mouseY =
                event.clientY -
                rect.top;


            const tooltip =
                $("nodeTooltip");


            if (
                hoveredNode >= 0
            )
            {

                const node =
                    nodes[
                        hoveredNode
                    ];


                $("tooltipCity")
                    .textContent =
                    node.city;


                $("tooltipName")
                    .textContent =
                    node.country;


                $("tooltipStatus")
                    .textContent =
                    "● Protected";


                tooltip.style.left =
                    (
                        mouseX + 16
                    ) +
                    "px";


                tooltip.style.top =
                    (
                        mouseY + 16
                    ) +
                    "px";


                tooltip.classList.add(
                    "show"
                );

            }
            else
            {

                tooltip.classList.remove(
                    "show"
                );

            }

        }
    );


    canvas.addEventListener(
        "mouseleave",
        () =>
        {

            $("nodeTooltip")
                ?.classList.remove(
                    "show"
                );

        }
    );



    /* ========================================================
       ANIMATION
       ======================================================== */

    function animate(time)
    {

        const rect =
            canvas.getBoundingClientRect();


        ctx.clearRect(
            0,
            0,
            rect.width,
            rect.height
        );


        drawPlanet(
            time
        );


        requestAnimationFrame(
            animate
        );

    }


    requestAnimationFrame(
        animate
    );

}



/* ============================================================
   DASHBOARD NUMBERS
   ============================================================ */

function initDashboardNumbers()
{

    const values =
    {

        servers:12,

        links:28,

        traffic:4.82,

        threats:1284

    };


    const serverEl =
        $("worldServers");


    const linksEl =
        $("worldLinks");


    const trafficEl =
        $("worldTraffic");


    const threatsEl =
        $("worldThreats");


    if (serverEl)
        serverEl.textContent =
            values.servers;


    if (linksEl)
        linksEl.textContent =
            values.links;


    if (trafficEl)
        trafficEl.innerHTML =
            values.traffic.toFixed(2) +
            ' <small>GB/s</small>';


    if (threatsEl)
        threatsEl.textContent =
            values.threats.toLocaleString();

}



/* ============================================================
   INIT
   ============================================================ */

async function init()
{

    /*
       Сначала запускаем основной экран.
    */

    initWorld();

    initDashboardNumbers();



    /*
       Загружаем модули последовательно.
    */

    for (
        const m of MODULE_MANIFEST
    )
    {

        try
        {

            await loadModuleAssets(
                m.id
            );

        }
        catch (e)
        {

            console.error(
                "Не удалось загрузить модуль '" +
                m.id +
                "':",
                e
            );

        }

    }



    showModule();



    if (
        await checkHealth()
    )
    {

        await loadModuleState();


        for (
            const m of MODULE_MANIFEST
        )
        {

            const impl =
                registry[m.id];


            if (
                moduleState[m.id] &&
                impl &&
                impl.initialLoad
            )
            {

                await impl.initialLoad();

            }

        }

    }
    else
    {

        renderNav();

    }


    setBusy(false);

}



/* ============================================================
   HEALTH REFRESH
   ============================================================ */

setInterval(
    checkHealth,
    10000
);



/* ============================================================
   START
   ============================================================ */

document.addEventListener(
    "DOMContentLoaded",
    init
);



/* ============================================================
   PUBLIC API
   ============================================================ */

return {

    $,

    api,

    setBusy,

    isBusy,

    banner,

    createLogger,

    ask,

    registerModule

};

})();