const API_CONFIG_TIMEOUT_MS = 8000;
const API_REQUEST_TIMEOUT_MS = 12000;
const $ = (id) => document.getElementById(id);

let apiConfigPromise = null;
let listRequestId = 0;
let detailRequestId = 0;
let modalTrigger = null;

function getApiOrigin() {
    const origin = window.PETALCORE_API_ORIGIN;
    if (typeof origin !== "string" || !origin.trim()) {
        throw new Error("The shared Petalcore API is not configured.");
    }
    return origin.trim().replace(/\/+$/, "");
}

async function fetchJson(url, options = {}, timeoutMs = API_REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
            cache: options.cache || "no-store"
        });
        let data;
        try {
            data = await response.json();
        } catch {
            throw new Error("The server returned an unexpected response. Please try again.");
        }

        if (!response.ok) {
            const detail = Array.isArray(data.detail)
                ? data.detail.map((item) => item.msg).filter(Boolean).join(" ")
                : data.detail;
            throw new Error(
                typeof detail === "string" && detail
                    ? detail
                    : "The plant request failed (HTTP " + response.status + ")."
            );
        }
        return data;
    } catch (error) {
        if (error.name === "AbortError") {
            throw new Error("The request took too long. Please try again.");
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

async function getApiConfig() {
    if (!apiConfigPromise) {
        const origin = getApiOrigin();
        apiConfigPromise = fetchJson(
            origin + "/config/index",
            {},
            API_CONFIG_TIMEOUT_MS
        ).then((config) => {
            if (typeof config.api_url !== "string" || typeof config.api_key !== "string") {
                throw new Error("The Index API configuration is incomplete.");
            }
            return {
                apiUrl: new URL(config.api_url, origin + "/").href.replace(/\/+$/, ""),
                apiKey: config.api_key
            };
        }).catch((error) => {
            apiConfigPromise = null;
            throw error;
        });
    }
    return apiConfigPromise;
}

async function fetchPlantData(endpoint) {
    const config = await getApiConfig();
    return fetchJson(config.apiUrl + endpoint, {
        headers: { "x-api-key": config.apiKey }
    });
}

function makeTextElement(tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = value == null ? "" : String(value);
    return element;
}

function showPlantListMessage(message, className = "loading-text") {
    const list = $("plantList");
    list.replaceChildren(makeTextElement("p", className, message));
}

function setPlantImage(image, plant, apiUrl) {
    const slug = typeof plant.image_slug === "string" ? plant.image_slug : "";
    const localImage = slug ? "images/" + encodeURIComponent(slug) + ".jpg" : null;
    image.alt = plant.common_name ? "Photo of " + plant.common_name : "Plant photo";
    image.loading = "lazy";
    image.decoding = "async";
    image.onerror = () => {
        if (!image.dataset.triedLocal && localImage) {
            image.dataset.triedLocal = "true";
            image.src = localImage;
            return;
        }
        image.onerror = null;
        image.src = "images/placeholder.jpg";
    };
    image.src = apiUrl + "/plants/" + encodeURIComponent(plant.id) + "/image";
}

function createPlantCard(plant, apiUrl) {
    const card = document.createElement("article");
    card.className = "plant-card";

    const imageWrap = document.createElement("div");
    imageWrap.className = "plant-image";
    const image = document.createElement("img");
    setPlantImage(image, plant, apiUrl);
    imageWrap.append(image);

    const content = document.createElement("div");
    content.className = "plant-card-body";
    content.append(
        makeTextElement("h3", "", plant.common_name),
        makeTextElement("p", "plant-scientific", plant.scientific_name),
        makeTextElement("p", "plant-family", plant.family),
        makeTextElement("p", "plant-description", plant.description)
    );

    const button = makeTextElement("button", "", "View Details");
    button.type = "button";
    button.addEventListener("click", () => viewPlant(plant.id, button));
    content.append(button);
    card.append(imageWrap, content);
    return card;
}

function displayPlants(plants, apiUrl) {
    const list = $("plantList");
    list.replaceChildren();

    if (!plants.length) {
        showPlantListMessage("No plants found.", "empty-state");
        return;
    }

    const fragment = document.createDocumentFragment();
    for (const plant of plants) {
        fragment.append(createPlantCard(plant, apiUrl));
    }
    list.append(fragment);
}

async function loadPlants() {
    const requestId = ++listRequestId;
    const list = $("plantList");
    list.setAttribute("aria-busy", "true");
    showPlantListMessage("Gathering the field notes…");

    try {
        const [data, config] = await Promise.all([
            fetchPlantData("/plants"),
            getApiConfig()
        ]);
        if (requestId !== listRequestId) return;
        displayPlants(Array.isArray(data.plants) ? data.plants : [], config.apiUrl);
    } catch (error) {
        if (requestId !== listRequestId) return;
        showPlantListMessage(error.message, "error-message");
    } finally {
        if (requestId === listRequestId) list.setAttribute("aria-busy", "false");
    }
}

async function searchPlants() {
    const query = $("searchInput").value.trim();
    if (!query) return loadPlants();

    const requestId = ++listRequestId;
    const list = $("plantList");
    list.setAttribute("aria-busy", "true");
    showPlantListMessage("Searching the plant library…");

    try {
        const [data, config] = await Promise.all([
            fetchPlantData("/plants/search?q=" + encodeURIComponent(query)),
            getApiConfig()
        ]);
        if (requestId !== listRequestId) return;
        displayPlants(Array.isArray(data.results) ? data.results : [], config.apiUrl);
    } catch (error) {
        if (requestId !== listRequestId) return;
        showPlantListMessage(error.message, "error-message");
    } finally {
        if (requestId === listRequestId) list.setAttribute("aria-busy", "false");
    }
}

function appendDetailRow(container, label, value) {
    const row = document.createElement("div");
    row.className = "modal-row";
    row.append(
        makeTextElement("span", "", label),
        makeTextElement("span", "", value || "Not provided")
    );
    container.append(row);
}

function displayPlantDetails(plant, apiUrl) {
    const content = $("modalContent");
    content.replaceChildren();
    content.append(
        makeTextElement("h2", "", plant.common_name),
        makeTextElement("p", "modal-scientific", plant.scientific_name)
    );

    const details = [
        ["Family", plant.family],
        ["Genus", plant.genus],
        ["Plant Type", plant.plant_type],
        ["Origin", plant.origin],
        ["Habitat", plant.habitat],
        ["Lifespan", plant.lifespan],
        ["Height", plant.height_m + " m"],
        ["Spread", plant.spread_m + " m"],
        ["Sunlight", plant.sunlight],
        ["Water", plant.water_requirement],
        ["Soil Type", plant.soil_type],
        ["Flower Color", plant.flower_color],
        ["Flowering Season", plant.flowering_season],
        ["Uses", plant.uses],
        ["Toxicity", plant.toxicity]
    ];
    for (const [label, value] of details) appendDetailRow(content, label, value);
    content.append(makeTextElement("p", "modal-description", plant.description));

    const image = $("modalImage");
    image.dataset.triedLocal = "";
    setPlantImage(image, plant, apiUrl);
}

function openModal(trigger) {
    const modal = $("plantModal");
    modalTrigger = trigger || null;
    modal.setAttribute("aria-hidden", "false");
    modal.classList.add("open");
    $("closeModalButton").focus();
}

function closeModal() {
    const modal = $("plantModal");
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    if (modalTrigger) modalTrigger.focus();
    modalTrigger = null;
}

async function viewPlant(id, trigger) {
    const requestId = ++detailRequestId;
    const content = $("modalContent");
    content.replaceChildren(makeTextElement("p", "loading-text", "Loading plant details…"));
    openModal(trigger);

    try {
        const [plant, config] = await Promise.all([
            fetchPlantData("/plants/" + encodeURIComponent(id)),
            getApiConfig()
        ]);
        if (requestId !== detailRequestId) return;
        displayPlantDetails(plant, config.apiUrl);
    } catch (error) {
        if (requestId !== detailRequestId) return;
        content.replaceChildren(makeTextElement("p", "error-message", error.message));
    }
}

function bindEvents() {
    $("searchForm").addEventListener("submit", (event) => {
        event.preventDefault();
        searchPlants();
    });
    $("showAllButton").addEventListener("click", () => {
        $("searchInput").value = "";
        loadPlants();
    });
    $("closeModalButton").addEventListener("click", closeModal);
    $("plantModal").addEventListener("click", (event) => {
        if (event.target === event.currentTarget) closeModal();
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && $("plantModal").classList.contains("open")) {
            closeModal();
        }
    });
}

bindEvents();
loadPlants();
