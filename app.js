const colourVariants = {
  cloudrunner: pendingVariants("cloudrunner", ["Eclipse / Black", "Frost / White"]),
  pegasus: pendingVariants("pegasus", ["White / Volt Ice / Barely Volt / Black", "Black / Bright Crimson / Topaz Gold"]),
  speedgoat: pendingVariants("speedgoat", ["Black / Stardust", "White / Neon Tangerine"]),
  "peg-trail": pendingVariants("peg-trail", ["Black / Anthracite", "Light Silver / College Grey"]),
  terrex: pendingVariants("terrex", ["Black / Grey", "Magic Grey / White / Semi Lucid Blue"]),
  ghost: pendingVariants("ghost", ["Coconut / Blue / Yellow", "Primer / Grey / Lime"]),
  challenger: pendingVariants("challenger", ["Black / Lettuce", "Stone Blue / Evening Primrose"]),
  vomero: pendingVariants("vomero", ["Photon Dust / Black / Volt", "White / Black Spruce / Volt Tint / Sapphire"])
};

const runningState = {
  selectedLocation: null,
  forecast: null,
  weather: null,
  distance: null,
  type: null
};
const runningTypeRanges = {
  "Daily Running": { min: 1, max: 15 },
  "Short Distance Running": { min: 1, max: 10 },
  "Long Distance Running": { min: 10, max: 42 },
  "Marathon Training": { min: 21, max: 42 },
  "Trail Running": { min: 1, max: 42 },
  "Sprint Training": { min: 1, max: 5 },
  "Treadmill Running": { min: 1, max: 15 }
};
const runningTypeRequirements = {
  "Daily Running": { terrain: ["Road", "Pavement", "Trail", "Indoor"], minimumCushioning: 2 },
  "Short Distance Running": { terrain: ["Road", "Pavement", "Trail", "Indoor"], minimumCushioning: 1 },
  "Long Distance Running": { terrain: ["Road", "Pavement", "Trail"], minimumCushioning: 3, minimumSupport: 1 },
  "Marathon Training": { terrain: ["Road", "Pavement"], minimumCushioning: 3, minimumSupport: 1 },
  "Trail Running": { terrain: ["Trail"], minimumCushioning: 2 },
  "Sprint Training": { terrain: ["Road", "Pavement", "Indoor"], minimumCushioning: 1, speedSuitable: true },
  "Treadmill Running": { terrain: ["Road", "Pavement", "Indoor"], minimumCushioning: 2 }
};
const selectedColourByShoe = new Map();
let imageAdminToken = "";
let imageServiceError = "";
let collectionMode = "all";
let activeBrandFilter = null;
let runningSearchTimer = null;
let runningSearchController = null;
const brandMarks = {
  On: "On",
  Nike: "NIKE",
  HOKA: "HOKA",
  adidas: "adidas",
  Brooks: "BROOKS",
  ASICS: "ASICS",
  Saucony: "SAUCONY",
  "New Balance": "NB",
  PUMA: "PUMA",
  Mizuno: "MIZUNO",
  Salomon: "SALOMON",
  Altra: "ALTRA",
  Merrell: "MERRELL",
  Skechers: "SKECHERS",
  Reebok: "REEBOK"
};

const runningProfiles = {
  cloudrunner: { types: ["Daily Running", "Short Distance Running", "Treadmill Running"], minKm: 1, maxKm: 15, cushioning: "Plush, stable", cushioningLevel: 4, support: "Guided stability", supportLevel: 2, terrain: "Road / pavement" },
  pegasus: { types: ["Daily Running", "Short Distance Running", "Long Distance Running", "Marathon Training", "Sprint Training", "Treadmill Running"], minKm: 1, maxKm: 42, cushioning: "Responsive", cushioningLevel: 3, support: "Neutral", supportLevel: 1, speedSuitable: true, terrain: "Road / pavement" },
  speedgoat: { types: ["Long Distance Running", "Marathon Training", "Trail Running"], minKm: 5, maxKm: 42, cushioning: "Cushioned", cushioningLevel: 4, support: "Protective neutral", supportLevel: 2, terrain: "Technical trail" },
  "peg-trail": { types: ["Daily Running", "Long Distance Running", "Trail Running"], minKm: 3, maxKm: 32, cushioning: "Balanced", cushioningLevel: 3, support: "Neutral", supportLevel: 1, terrain: "Road / light trail" },
  terrex: { types: ["Long Distance Running", "Trail Running"], minKm: 5, maxKm: 32, cushioning: "Responsive", cushioningLevel: 2, support: "Secure, protective", supportLevel: 2, terrain: "Trail / mud" },
  ghost: { types: ["Daily Running", "Short Distance Running", "Long Distance Running", "Marathon Training", "Treadmill Running"], minKm: 1, maxKm: 42, cushioning: "Balanced", cushioningLevel: 3, support: "Neutral", supportLevel: 1, terrain: "Road / pavement" },
  challenger: { types: ["Daily Running", "Long Distance Running", "Trail Running"], minKm: 3, maxKm: 32, cushioning: "Cushioned", cushioningLevel: 4, support: "Neutral", supportLevel: 1, terrain: "Road / park trail" },
  vomero: { types: ["Daily Running", "Long Distance Running", "Marathon Training", "Treadmill Running"], minKm: 1, maxKm: 42, cushioning: "Maximum", cushioningLevel: 5, support: "Neutral", supportLevel: 1, terrain: "Road / pavement" }
};

function pendingVariants(shoeId, colors) {
  const options = colors.length ? colors : ["Colorway details pending verification"];
  return options.map((color, index) => ({
    id: `${shoeId}-color-${index + 1}`,
    color,
    images: [],
    imageStatus: "pending"
  }));
}

const additionalShoes = [
  {
    id: "asics-nimbus-27", brand: "ASICS", name: "Gel-Nimbus 27", category: "Road running",
    description: "A highly cushioned neutral road shoe suited to easy miles and longer runs.",
    weather: ["Sunny", "Cloudy", "Cold"], terrain: ["Road", "Pavement"],
    pros: ["Soft, protective cushioning", "Comfortable for easy mileage", "Stable neutral platform"],
    cons: ["Less nimble for fast sessions", "Bulky feel compared with lighter trainers"],
    rating: "Plush road comfort",
    variants: pendingVariants("asics-nimbus-27", ["Midnight / Vanilla", "Illusion Blue / Indigo Blue"]),
    running: { types: ["Daily Running", "Long Distance Running", "Marathon Training", "Treadmill Running"], minKm: 3, maxKm: 42, cushioning: "Maximum, soft", cushioningLevel: 5, support: "Neutral", supportLevel: 1, terrain: "Road / pavement" }
  },
  {
    id: "asics-novablast-5", brand: "ASICS", name: "Novablast 5", category: "Road running",
    description: "A bouncy neutral road trainer for daily runs, steady efforts, and longer mileage.",
    weather: ["Sunny", "Cloudy", "Hot"], terrain: ["Road", "Pavement"],
    pros: ["Energetic, cushioned ride", "Versatile for daily training", "Light enough for quicker efforts"],
    cons: ["Less structured than a stability shoe", "Bouncy platform may not suit every runner"],
    rating: "Bouncy daily miles",
    variants: pendingVariants("asics-novablast-5", ["Arctic Blue / Aegean Blue", "Gravel / White"]),
    running: { types: ["Daily Running", "Short Distance Running", "Long Distance Running", "Marathon Training", "Sprint Training", "Treadmill Running"], minKm: 1, maxKm: 42, cushioning: "Bouncy, high", cushioningLevel: 4, support: "Neutral", supportLevel: 1, speedSuitable: true, terrain: "Road / pavement" }
  },
  {
    id: "asics-cumulus-27", brand: "ASICS", name: "Gel-Cumulus 27", category: "Road running",
    description: "A balanced neutral road shoe for everyday training and steady long runs.",
    weather: ["Sunny", "Cloudy", "Cold"], terrain: ["Road", "Pavement"],
    pros: ["Balanced cushioning", "Versatile for routine mileage", "Smooth road transitions"],
    cons: ["Less plush than maximum-cushion models", "Not specialized for speedwork"],
    rating: "Balanced daily trainer",
    variants: pendingVariants("asics-cumulus-27", ["Black / Concrete", "White / Lake Grey"]),
    running: { types: ["Daily Running", "Short Distance Running", "Long Distance Running", "Marathon Training", "Treadmill Running"], minKm: 1, maxKm: 42, cushioning: "Balanced", cushioningLevel: 3, support: "Neutral", supportLevel: 1, terrain: "Road / pavement" }
  },
  {
    id: "asics-kayano-31", brand: "ASICS", name: "Gel-Kayano 31", category: "Road running",
    description: "A structured stability road shoe with substantial cushioning for everyday and long runs.",
    weather: ["Sunny", "Cloudy", "Cold"], terrain: ["Road", "Pavement"],
    pros: ["Guided, stable platform", "Protective cushioning", "Comfortable for longer road runs"],
    cons: ["Built-up feel is less agile", "Heavier than a lightweight trainer"],
    rating: "Stable long-run comfort",
    variants: pendingVariants("asics-kayano-31", ["Green", "Black / Rainy Lake"]),
    running: { types: ["Daily Running", "Long Distance Running", "Marathon Training", "Treadmill Running"], minKm: 1, maxKm: 42, cushioning: "High, structured", cushioningLevel: 4, support: "Stability guidance", supportLevel: 3, terrain: "Road / pavement" }
  },
  {
    id: "saucony-ride-18", brand: "Saucony", name: "Ride 18", category: "Road running",
    description: "A neutral daily road trainer with a balanced feel for regular training mileage.",
    weather: ["Sunny", "Cloudy", "Cold"], terrain: ["Road", "Pavement"],
    pros: ["Versatile everyday cushioning", "Suitable for steady runs", "Neutral platform"],
    cons: ["Less plush than the Triumph", "Not a plated speed shoe"],
    rating: "Everyday versatility",
    variants: pendingVariants("saucony-ride-18", ["Arctic / Barley", "Black / White"]),
    running: { types: ["Daily Running", "Short Distance Running", "Long Distance Running", "Marathon Training", "Treadmill Running"], minKm: 1, maxKm: 42, cushioning: "Balanced", cushioningLevel: 3, support: "Neutral", supportLevel: 1, terrain: "Road / pavement" }
  },
  {
    id: "saucony-triumph-22", brand: "Saucony", name: "Triumph 22", category: "Road running",
    description: "A plush neutral trainer designed for comfortable easy runs and longer road days.",
    weather: ["Sunny", "Cloudy", "Cold"], terrain: ["Road", "Pavement"],
    pros: ["Soft, protective cushioning", "Comfortable for recovery miles", "Well suited to longer runs"],
    cons: ["Bulkier than a tempo shoe", "Less agile for short fast intervals"],
    rating: "Plush long-run feel",
    variants: pendingVariants("saucony-triumph-22", ["Mirage / Black", "Black / White"]),
    running: { types: ["Daily Running", "Long Distance Running", "Marathon Training", "Treadmill Running"], minKm: 3, maxKm: 42, cushioning: "Plush", cushioningLevel: 5, support: "Neutral", supportLevel: 1, terrain: "Road / pavement" }
  },
  {
    id: "saucony-endorphin-speed-4", brand: "Saucony", name: "Endorphin Speed 4", category: "Road running",
    description: "A responsive plated road trainer for faster workouts and race-pace efforts.",
    weather: ["Sunny", "Cloudy", "Hot"], terrain: ["Road", "Pavement"],
    pros: ["Responsive for tempo work", "Versatile for intervals and faster long runs", "Light, energetic ride"],
    cons: ["Plate may feel firm at easy pace", "Less forgiving than a recovery shoe"],
    rating: "Fast-session favorite",
    variants: pendingVariants("saucony-endorphin-speed-4", ["Citron / Navy", "Viziblue / Navy"]),
    running: { types: ["Short Distance Running", "Long Distance Running", "Marathon Training", "Sprint Training"], minKm: 1, maxKm: 42, cushioning: "Responsive, high", cushioningLevel: 4, support: "Neutral, plated", supportLevel: 1, speedSuitable: true, terrain: "Road / pavement" }
  },
  {
    id: "nb-1080-v14", brand: "New Balance", name: "Fresh Foam X 1080v14", category: "Road running",
    description: "A soft neutral road shoe for relaxed daily miles and longer efforts.",
    weather: ["Sunny", "Cloudy", "Cold"], terrain: ["Road", "Pavement"],
    pros: ["Soft Fresh Foam X cushioning", "Comfortable for easy mileage", "Protective long-run ride"],
    cons: ["Softness can feel less crisp at speed", "Not designed for technical trails"],
    rating: "Soft road cushioning",
    variants: pendingVariants("nb-1080-v14", ["Grey Matter / Slate Gray / Castlerock", "Black / Magnet / Linen"]),
    running: { types: ["Daily Running", "Long Distance Running", "Marathon Training", "Treadmill Running"], minKm: 3, maxKm: 42, cushioning: "Soft, high", cushioningLevel: 5, support: "Neutral", supportLevel: 1, terrain: "Road / pavement" }
  },
  {
    id: "nb-880-v15", brand: "New Balance", name: "Fresh Foam X 880v15", category: "Road running",
    description: "A neutral daily trainer with balanced cushioning for routine road training.",
    weather: ["Sunny", "Cloudy", "Cold"], terrain: ["Road", "Pavement"],
    pros: ["Reliable everyday cushioning", "Versatile across easy and steady runs", "Road-focused outsole"],
    cons: ["Less lively than speed-oriented shoes", "Less plush than maximum-cushion models"],
    rating: "Dependable daily miles",
    variants: pendingVariants("nb-880-v15", ["Medusa Green / Cosmic Jade", "Linen / Dream State"]),
    running: { types: ["Daily Running", "Short Distance Running", "Long Distance Running", "Marathon Training", "Treadmill Running"], minKm: 1, maxKm: 42, cushioning: "Balanced", cushioningLevel: 3, support: "Neutral", supportLevel: 1, terrain: "Road / pavement" }
  },
  {
    id: "nb-rebel-v5", brand: "New Balance", name: "FuelCell Rebel v5", category: "Road running",
    description: "A lighter-feeling neutral trainer suited to daily running and quicker workouts.",
    weather: ["Sunny", "Cloudy", "Hot"], terrain: ["Road", "Pavement"],
    pros: ["Lively FuelCell ride", "Useful for faster training", "Lightweight feel"],
    cons: ["Less structured than a stability shoe", "Less protective than a max-cushion trainer"],
    rating: "Lively daily trainer",
    variants: pendingVariants("nb-rebel-v5", ["Mint Flash / Lab Green / Silver Metallic", "White / Black / Silver Metallic"]),
    running: { types: ["Daily Running", "Short Distance Running", "Long Distance Running", "Sprint Training", "Treadmill Running"], minKm: 1, maxKm: 32, cushioning: "Responsive", cushioningLevel: 3, support: "Neutral", supportLevel: 1, speedSuitable: true, terrain: "Road / pavement" }
  },
  {
    id: "adidas-boston-13", brand: "adidas", name: "Adizero Boston 13", category: "Road running",
    description: "A performance-oriented road trainer for tempo sessions and faster long runs.",
    weather: ["Sunny", "Cloudy", "Hot"], terrain: ["Road", "Pavement"],
    pros: ["Energetic training ride", "Suitable for tempo and progression runs", "Road-ready grip"],
    cons: ["Firmer than a recovery shoe", "Less comfortable for some runners at easy pace"],
    rating: "Tempo-ready trainer",
    variants: pendingVariants("adidas-boston-13", ["White / Light Blue / Gold Metallic", "Black / White / Black"]),
    running: { types: ["Short Distance Running", "Long Distance Running", "Marathon Training", "Sprint Training"], minKm: 1, maxKm: 42, cushioning: "Responsive", cushioningLevel: 3, support: "Neutral", supportLevel: 1, speedSuitable: true, terrain: "Road / pavement" }
  },
  {
    id: "adidas-supernova-rise-2", brand: "adidas", name: "Supernova Rise 2", category: "Road running",
    description: "A neutral cushioned daily trainer for comfortable easy-to-steady road runs.",
    weather: ["Sunny", "Cloudy", "Cold"], terrain: ["Road", "Pavement"],
    pros: ["Comfortable daily cushioning", "Stable-feeling platform", "Versatile for routine runs"],
    cons: ["Less lively for speedwork", "Not intended for technical terrain"],
    rating: "Steady daily comfort",
    variants: pendingVariants("adidas-supernova-rise-2", ["Cloud White / Blue Fusion / Flash Orange", "Black"]),
    running: { types: ["Daily Running", "Short Distance Running", "Long Distance Running", "Marathon Training", "Treadmill Running"], minKm: 1, maxKm: 42, cushioning: "Balanced, cushioned", cushioningLevel: 3, support: "Neutral", supportLevel: 1, terrain: "Road / pavement" }
  },
  {
    id: "puma-velocity-nitro-3", brand: "PUMA", name: "Velocity Nitro 3", category: "Road running",
    description: "A neutral all-rounder for daily road running, with a durable outsole for regular use.",
    weather: ["Sunny", "Cloudy", "Rainy"], terrain: ["Road", "Pavement"],
    pros: ["Versatile daily ride", "Grippy outsole", "Balanced for easy and moderate efforts"],
    cons: ["Not a plated speed specialist", "Road outsole is not for technical trails"],
    rating: "All-round road grip",
    variants: pendingVariants("puma-velocity-nitro-3", ["White", "Neon Citrus / Silver / Dewdrop"]),
    running: { types: ["Daily Running", "Short Distance Running", "Long Distance Running", "Sprint Training", "Treadmill Running"], minKm: 1, maxKm: 35, cushioning: "Responsive", cushioningLevel: 3, support: "Neutral", supportLevel: 1, speedSuitable: true, terrain: "Road / pavement" }
  },
  {
    id: "puma-deviate-nitro-3", brand: "PUMA", name: "Deviate Nitro 3", category: "Road running",
    description: "A plated performance trainer for tempo work, intervals, and race-pace sessions.",
    weather: ["Sunny", "Cloudy", "Hot"], terrain: ["Road", "Pavement"],
    pros: ["Propulsive workout feel", "Cushioned for faster efforts", "Grippy road outsole"],
    cons: ["Plate can feel stiff at easy pace", "Less versatile for recovery runs"],
    rating: "Propulsive workouts",
    variants: pendingVariants("puma-deviate-nitro-3", ["Black / Speed Blue"]),
    running: { types: ["Short Distance Running", "Long Distance Running", "Marathon Training", "Sprint Training"], minKm: 1, maxKm: 42, cushioning: "Responsive, high", cushioningLevel: 4, support: "Neutral, plated", supportLevel: 1, speedSuitable: true, terrain: "Road / pavement" }
  },
  {
    id: "mizuno-wave-rider-28", brand: "Mizuno", name: "Wave Rider 28", category: "Road running",
    description: "A neutral daily road trainer with a smooth transition and balanced cushioning.",
    weather: ["Sunny", "Cloudy", "Cold"], terrain: ["Road", "Pavement"],
    pros: ["Smooth road transitions", "Stable-feeling neutral platform", "Durable daily-training design"],
    cons: ["Firmer than plush max-cushion shoes", "Not built for technical trails"],
    rating: "Smooth daily miles",
    variants: pendingVariants("mizuno-wave-rider-28", ["Black / Silver"]),
    running: { types: ["Daily Running", "Short Distance Running", "Long Distance Running", "Marathon Training", "Treadmill Running"], minKm: 1, maxKm: 42, cushioning: "Balanced", cushioningLevel: 3, support: "Neutral", supportLevel: 2, terrain: "Road / pavement" }
  },
  {
    id: "on-cloudmonster-2", brand: "On", name: "Cloudmonster 2", category: "Road running",
    description: "A maximal, rocker-assisted road trainer for cushioned daily and longer runs.",
    weather: ["Sunny", "Cloudy", "Cold"], terrain: ["Road", "Pavement"],
    pros: ["High cushioning", "Rocker-assisted transitions", "Comfortable for longer road efforts"],
    cons: ["Bulky feel", "Less agile for short fast intervals"],
    rating: "Max-cushion rocker",
    variants: pendingVariants("on-cloudmonster-2", ["Asphalt / Lima", "Black / Glacier"]),
    running: { types: ["Daily Running", "Long Distance Running", "Marathon Training", "Treadmill Running"], minKm: 3, maxKm: 42, cushioning: "Maximum", cushioningLevel: 5, support: "Neutral", supportLevel: 1, terrain: "Road / pavement" }
  },
  {
    id: "on-cloudsurfer-2", brand: "On", name: "Cloudsurfer 2", category: "Road running",
    description: "A smooth neutral road trainer for comfortable daily miles and steady efforts.",
    weather: ["Sunny", "Cloudy", "Hot"], terrain: ["Road", "Pavement"],
    pros: ["Smooth cushioning transition", "Comfortable for daily runs", "Neutral road platform"],
    cons: ["Less suited to aggressive speed sessions", "Road-only traction"],
    rating: "Smooth daily comfort",
    variants: pendingVariants("on-cloudsurfer-2", ["Tangerine / Ivory"]),
    running: { types: ["Daily Running", "Short Distance Running", "Long Distance Running", "Treadmill Running"], minKm: 1, maxKm: 32, cushioning: "Cushioned, smooth", cushioningLevel: 4, support: "Neutral", supportLevel: 1, terrain: "Road / pavement" }
  },
  {
    id: "nike-zoom-fly-6", brand: "Nike", name: "Zoom Fly 6", category: "Road running",
    description: "A carbon-plated road trainer for tempo runs and race-pace workouts.",
    weather: ["Sunny", "Cloudy", "Hot"], terrain: ["Road", "Pavement"],
    pros: ["Propulsive feel for workouts", "Cushioned for race-pace training", "Versatile for tempo and intervals"],
    cons: ["Stiffer than an everyday trainer", "Less natural at slow recovery pace"],
    rating: "Race-pace training",
    variants: pendingVariants("nike-zoom-fly-6", ["Obsidian / White / Persian Violet", "White / Gridiron / Pure Platinum"]),
    running: { types: ["Short Distance Running", "Long Distance Running", "Marathon Training", "Sprint Training"], minKm: 1, maxKm: 42, cushioning: "Responsive, plated", cushioningLevel: 4, support: "Neutral", supportLevel: 1, speedSuitable: true, terrain: "Road / pavement" }
  },
  {
    id: "salomon-speedcross-6", brand: "Salomon", name: "Speedcross 6", category: "Trail running",
    description: "A traction-focused trail shoe intended for soft, muddy, and technical paths.",
    weather: ["Rainy", "Cloudy", "Cold"], terrain: ["Trail", "Muddy", "Grass"],
    pros: ["Aggressive trail grip", "Secure foothold", "Agile on soft ground"],
    cons: ["Can feel narrow or firm", "Chunky lugs are less suited to pavement"],
    rating: "Mud-ready traction",
    variants: pendingVariants("salomon-speedcross-6", []),
    running: { types: ["Trail Running", "Daily Running", "Long Distance Running"], minKm: 3, maxKm: 32, cushioning: "Moderate, protective", cushioningLevel: 3, support: "Secure neutral fit", supportLevel: 2, terrain: "Technical trail / mud" }
  },
  {
    id: "altra-lone-peak-9", brand: "Altra", name: "Lone Peak 9", category: "Trail running",
    description: "A roomy, zero-drop trail shoe for natural-feeling movement over mixed terrain.",
    weather: ["Rainy", "Cloudy", "Sunny"], terrain: ["Trail", "Rocky", "Grass"],
    pros: ["Roomy toe box", "Flexible trail platform", "Versatile for runs and hikes"],
    cons: ["Zero-drop transition may take adaptation", "Less plush than max-cushion trail shoes"],
    rating: "Roomy trail fit",
    variants: pendingVariants("altra-lone-peak-9", []),
    running: { types: ["Trail Running", "Daily Running", "Long Distance Running"], minKm: 3, maxKm: 42, cushioning: "Moderate", cushioningLevel: 3, support: "Neutral, zero-drop", supportLevel: 1, terrain: "Mixed trail" }
  },
  {
    id: "merrell-agility-peak-5", brand: "Merrell", name: "Agility Peak 5", category: "Trail running",
    description: "A cushioned trail shoe designed for protective comfort on mixed and technical paths.",
    weather: ["Rainy", "Cloudy", "Sunny"], terrain: ["Trail", "Rocky", "Grass"],
    pros: ["Protective cushioning", "Grippy trail outsole", "Comfortable for longer outings"],
    cons: ["Bulkier than agile trail racers", "Can feel less nimble on roads"],
    rating: "Protective trail miles",
    variants: pendingVariants("merrell-agility-peak-5", []),
    running: { types: ["Trail Running", "Long Distance Running"], minKm: 5, maxKm: 42, cushioning: "Plush", cushioningLevel: 5, support: "Neutral, protective", supportLevel: 2, terrain: "Technical trail" }
  },
  {
    id: "brooks-cascadia-18", brand: "Brooks", name: "Cascadia 18", category: "Trail running",
    description: "A protective, adaptable trail shoe for varied terrain and everyday trail mileage.",
    weather: ["Rainy", "Cloudy", "Sunny"], terrain: ["Trail", "Rocky", "Muddy"],
    pros: ["Stable platform over varied surfaces", "Protective trail build", "Versatile for regular trail runs"],
    cons: ["Less plush than max-cushion trail shoes", "Not especially light"],
    rating: "All-round trail stability",
    variants: pendingVariants("brooks-cascadia-18", []),
    running: { types: ["Trail Running", "Daily Running", "Long Distance Running"], minKm: 3, maxKm: 42, cushioning: "Moderate", cushioningLevel: 3, support: "Stable neutral", supportLevel: 2, terrain: "Mixed trail" }
  },
  {
    id: "nb-hierro-v9", brand: "New Balance", name: "Fresh Foam X Hierro v9", category: "Trail running",
    description: "A cushioned trail shoe for comfortable outings across mixed and longer routes.",
    weather: ["Rainy", "Cloudy", "Sunny"], terrain: ["Trail", "Rocky", "Grass"],
    pros: ["Soft Fresh Foam X cushioning", "Trail-focused traction", "Protective for longer outings"],
    cons: ["Can feel bulky on technical terrain", "Less efficient on pavement"],
    rating: "Cushioned trail comfort",
    variants: pendingVariants("nb-hierro-v9", []),
    running: { types: ["Trail Running", "Long Distance Running"], minKm: 5, maxKm: 42, cushioning: "Plush", cushioningLevel: 5, support: "Neutral", supportLevel: 1, terrain: "Mixed / long trail" }
  },
  {
    id: "saucony-peregrine-15", brand: "Saucony", name: "Peregrine 15", category: "Trail running",
    description: "A responsive trail shoe built for traction-oriented running on uneven paths.",
    weather: ["Rainy", "Cloudy", "Sunny"], terrain: ["Trail", "Rocky", "Muddy"],
    pros: ["Grippy outsole for technical routes", "Agile trail feel", "Responsive underfoot"],
    cons: ["Firmer than plush long-run models", "Lugs are less comfortable on pavement"],
    rating: "Technical trail response",
    variants: pendingVariants("saucony-peregrine-15", []),
    running: { types: ["Trail Running", "Daily Running", "Short Distance Running", "Long Distance Running"], minKm: 1, maxKm: 42, cushioning: "Moderate, responsive", cushioningLevel: 3, support: "Neutral", supportLevel: 1, terrain: "Technical trail" }
  },
  {
    id: "adidas-ultraboost-5x", brand: "adidas", name: "Ultraboost 5X", category: "Road running",
    description: "A cushioned road shoe suited to comfortable daily runs and casual all-day wear.",
    weather: ["Sunny", "Cloudy", "Cold"], terrain: ["Road", "Pavement"],
    pros: ["Comfortable Boost cushioning", "Smooth for easy running", "Versatile everyday styling"],
    cons: ["Heavier than lightweight trainers", "Can feel warm in hot conditions"],
    rating: "Cushioned everyday wear",
    variants: pendingVariants("adidas-ultraboost-5x", []),
    running: { types: ["Daily Running", "Short Distance Running", "Long Distance Running", "Treadmill Running"], minKm: 1, maxKm: 25, cushioning: "Cushioned", cushioningLevel: 4, support: "Neutral", supportLevel: 1, terrain: "Road / pavement" }
  },
  {
    id: "nike-air-max-90", brand: "Nike", name: "Air Max 90", category: "Casual sneaker",
    description: "A classic lifestyle sneaker for everyday wear on urban surfaces.",
    weather: ["Sunny", "Cloudy"], terrain: ["Pavement", "Urban"],
    pros: ["Durable-feeling everyday build", "Recognizable classic styling", "Comfortable for casual use"],
    cons: ["Heavy and stiff for running", "Not intended for distance training"],
    rating: "Classic casual style",
    variants: pendingVariants("nike-air-max-90", []),
    running: { types: [], minKm: 1, maxKm: 42, cushioning: "Lifestyle cushioning", cushioningLevel: 2, support: "Casual support", supportLevel: 1, terrain: "Urban pavement" }
  },
  {
    id: "nb-574", brand: "New Balance", name: "574", category: "Casual sneaker",
    description: "A versatile lifestyle sneaker for everyday walking and casual outfits.",
    weather: ["Sunny", "Cloudy", "Cold"], terrain: ["Pavement", "Urban"],
    pros: ["Everyday versatility", "Comfortable for casual walking", "Durable-feeling outsole"],
    cons: ["Heavier and stiffer than running shoes", "Not intended for distance running"],
    rating: "Everyday classic",
    variants: pendingVariants("nb-574", []),
    running: { types: [], minKm: 1, maxKm: 42, cushioning: "Moderate lifestyle cushioning", cushioningLevel: 2, support: "Casual support", supportLevel: 1, terrain: "Urban pavement" }
  },
  {
    id: "nike-p-6000", brand: "Nike", name: "P-6000", category: "Casual sneaker",
    description: "A retro-inspired casual sneaker for daily wear and light walking.",
    weather: ["Sunny", "Cloudy"], terrain: ["Pavement", "Urban"],
    pros: ["Breathable layered upper", "Comfortable for casual wear", "Retro running-inspired design"],
    cons: ["Not a current performance-running shoe", "Bulky for structured training"],
    rating: "Retro everyday comfort",
    variants: pendingVariants("nike-p-6000", []),
    running: { types: [], minKm: 1, maxKm: 42, cushioning: "Moderate lifestyle cushioning", cushioningLevel: 2, support: "Casual support", supportLevel: 1, terrain: "Urban pavement" }
  },
  {
    id: "skechers-go-walk-flex", brand: "Skechers", name: "GO WALK Flex", category: "Walking",
    description: "A lightweight walking shoe for everyday errands and indoor or sidewalk use.",
    weather: ["Sunny", "Cloudy", "Cold"], terrain: ["Sidewalk", "Indoor"],
    pros: ["Flexible walking platform", "Lightweight everyday feel", "Comfortable for casual walks"],
    cons: ["Less structured than a running shoe", "Not designed for technical trails"],
    rating: "Flexible walking comfort",
    variants: pendingVariants("skechers-go-walk-flex", []),
    running: { types: [], minKm: 1, maxKm: 42, cushioning: "Walking comfort", cushioningLevel: 2, support: "Walking-oriented", supportLevel: 1, terrain: "Sidewalk / indoor" }
  },
  {
    id: "skechers-max-cushioning-endeavour", brand: "Skechers", name: "Max Cushioning Endeavour", category: "Walking",
    description: "A high-cushion walking shoe for extended standing and everyday fitness walks.",
    weather: ["Sunny", "Cloudy", "Cold"], terrain: ["Sidewalk", "Indoor"],
    pros: ["Soft cushioned platform", "Comfortable for longer walks", "Rocker-style walking transition"],
    cons: ["Bulkier feel", "Less precise for fast workouts"],
    rating: "Maximum walking comfort",
    variants: pendingVariants("skechers-max-cushioning-endeavour", []),
    running: { types: [], minKm: 1, maxKm: 42, cushioning: "High walking cushion", cushioningLevel: 4, support: "Walking-oriented", supportLevel: 1, terrain: "Sidewalk / indoor" }
  },
  {
    id: "reebok-nano-x5", brand: "Reebok", name: "Nano X5", category: "Training",
    description: "A cross-training shoe designed for strength sessions and varied gym workouts.",
    weather: ["Sunny", "Cloudy"], terrain: ["Indoor", "Gym"],
    pros: ["Stable platform for lifting", "Versatile for mixed gym sessions", "Secure training-oriented build"],
    cons: ["Too firm for distance running", "Not intended for technical outdoor trails"],
    rating: "Stable gym training",
    variants: pendingVariants("reebok-nano-x5", []),
    running: { types: [], minKm: 1, maxKm: 42, cushioning: "Firm, training-focused", cushioningLevel: 2, support: "Stable training platform", supportLevel: 3, terrain: "Gym / indoor" }
  },
  {
    id: "nike-metcon-10", brand: "Nike", name: "Metcon 10", category: "Training",
    description: "A stable training shoe for strength work and multidirectional gym sessions.",
    weather: ["Sunny", "Cloudy"], terrain: ["Indoor", "Gym"],
    pros: ["Stable base for lifting", "Secure for multidirectional drills", "Training-focused traction"],
    cons: ["Stiff and heavy for distance running", "Not designed for trail use"],
    rating: "Strength-session stability",
    variants: pendingVariants("nike-metcon-10", []),
    running: { types: [], minKm: 1, maxKm: 42, cushioning: "Firm, stable", cushioningLevel: 2, support: "Stable training platform", supportLevel: 3, terrain: "Gym / indoor" }
  }
];

shoes.push(...additionalShoes);
if (shoes.length !== 40 || new Set(shoes.map((shoe) => shoe.id)).size !== 40 ||
    new Set(shoes.map((shoe) => `${shoe.brand}:${shoe.name}`)).size !== 40) {
  throw new Error("The shoe catalog must contain exactly 40 unique models.");
}

shoes.forEach((shoe) => {
  shoe.variants = shoe.variants || colourVariants[shoe.id];
  if (!Array.isArray(shoe.variants)) {
    throw new Error(`Catalog data is incomplete for ${shoe.brand} ${shoe.name}.`);
  }
  // Only galleries explicitly cleared for reuse are rendered.
  shoe.variants = shoe.variants.map((variant) => ({
    ...variant,
    images: variant.imageAuthorized === true ? variant.images : [],
    imageRecords: variant.imageAuthorized === true && Array.isArray(variant.imageRecords) ? variant.imageRecords : [],
    imageStatus: variant.imageAuthorized === true ? "available" : "pending"
  }));
  const variantIds = shoe.variants && shoe.variants.map((variant) => variant.id);
  const variantsComplete = Array.isArray(shoe.variants) && shoe.variants.length >= 1 &&
    shoe.variants.every((variant) => variant.id && variant.color && Array.isArray(variant.images) &&
      (variant.images.length > 0 || variant.imageStatus === "pending")) &&
    new Set(variantIds).size === variantIds.length;
  if (!variantsComplete || !shoe.running && !runningProfiles[shoe.id]) {
    throw new Error(`Catalog data is incomplete for ${shoe.brand} ${shoe.name}.`);
  }
  shoe.images = shoe.variants[0].images;
  shoe.running = shoe.running || runningProfiles[shoe.id];
  if (!Array.isArray(shoe.running.types) || !Number.isFinite(shoe.running.minKm) || !Number.isFinite(shoe.running.maxKm) ||
      !Number.isFinite(shoe.running.cushioningLevel) || !Number.isFinite(shoe.running.supportLevel)) {
    throw new Error(`Running profile is incomplete for ${shoe.brand} ${shoe.name}.`);
  }
  shoe.category = shoe.category || (shoe.terrain.includes("Trail") ? "Trail running" : "Running");
  if (!commuteFit[shoe.id]) {
    const mixedSurface = shoe.terrain.includes("Trail");
    commuteFit[shoe.id] = {
      Bike: mixedSurface ? "Grippy tread for changing conditions and walk-ups" : "Comfortable road grip for short city walk-ups",
      Cycle: mixedSurface ? "Adaptable traction for mixed-surface routes" : "Lightweight comfort for everyday city plans",
      Car: mixedSurface ? "Protective grip for paths beyond the car park" : "Cushioned comfort for all-day wear"
    };
  }
});

function currentVariant(shoe) {
  return shoe.variants.find((variant) => variant.id === selectedColourByShoe.get(shoe.id)) || shoe.variants[0];
}

function renderShoePhoto(shoe, variant) {
  if (!variant.images.length) {
    return `<div class="shoe-photo shoe-photo-placeholder" role="img" aria-label="Product image unavailable for ${shoe.brand} ${shoe.name}, ${variant.color}">
      <div class="shoe-image-placeholder"><span>PRODUCT IMAGE</span><strong>${shoe.brand}</strong><span>${shoe.name}</span><small>${variant.color}</small><small>Image unavailable</small></div>
    </div>`;
  }
  const gallery = variant.images.length > 1
    ? `<button class="gallery-arrow prev" data-gallery="prev" aria-label="Previous view of ${shoe.name}">‹</button>
      <button class="gallery-arrow next" data-gallery="next" aria-label="Next view of ${shoe.name}">›</button>
      <span class="photo-count" data-count>01 / ${String(variant.images.length).padStart(2, "0")}</span>`
    : "";
  const imageId = variant.imageRecords[0] ? variant.imageRecords[0].id : "";
  const angle = variant.imageRecords[0] ? variant.imageRecords[0].angle : "Unspecified";
  return `<div class="shoe-photo image-loading">
    <img src="${variant.images[0]}" alt="${shoe.brand} ${shoe.name} in ${variant.color}, ${angle} view" loading="lazy" data-shoe-image data-index="0" data-variant="${variant.id}" data-image-id="${imageId}">
    <span class="image-loading-label" role="status">Loading product image…</span>
    ${renderImageCredit(variant.imageRecords[0])}
    ${gallery}
  </div>`;
}

function renderImageCredit(record) {
  if (!record) return "";
  const sourceUrl = safeImageLink(record.productUrl);
  const licenseUrl = safeImageLink(record.licenseUrl);
  if (!sourceUrl || !licenseUrl) return "";
  return `<div class="image-credit"><a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">Source</a>
    <a href="${escapeHtml(licenseUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(record.license)}</a>
    <span>${escapeHtml(record.attribution || "Attribution not specified")}</span></div>`;
}

function safeImageLink(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function renderShoeGrid(list, gridId, context) {
  const grid = document.getElementById(gridId);
  if (!list.length) {
    const message = context === "running"
      ? "No shoes in this collection meet all of those running requirements. Try a different distance, type, or weather."
      : context === "collection"
        ? "No shoes match that brand or model search."
        : "No exact shoe match for this combination yet. Try another weather or commute choice.";
    grid.innerHTML = `<div class="empty-state">${message}</div>`;
    return;
  }

  grid.innerHTML = list.map((shoe) => {
    const variant = currentVariant(shoe);
    const runningDetails = context === "running"
      ? `<div class="running-specs"><strong>Cushioning</strong> · ${shoe.running.cushioning}<br><strong>Support</strong> · ${shoe.running.support}<br><strong>Terrain</strong> · ${shoe.running.terrain}<br><strong>Weather</strong> · ${shoe.weather.join(", ")}</div>`
      : "";
    const commuteDetails = context === "home" && state.commute && commuteFit[shoe.id] && commuteFit[shoe.id][state.commute]
      ? `<div class="commute-fit"><strong>${state.commute} fit</strong> · ${commuteFit[shoe.id][state.commute]}</div>`
      : "";
    return `<article class="shoe-card" data-shoe-card="${shoe.id}">
      ${renderShoePhoto(shoe, variant)}
      <div class="shoe-content">
        <div class="shoe-brandline"><span>${shoe.brand}</span><span class="size-tag">UK 8</span></div>
        <h3 class="shoe-name">${shoe.name}</h3>
        <p class="shoe-desc">${shoe.description}</p>
        ${shoe.variants.length > 1 ? `<div class="colour-picker" role="group" aria-label="${shoe.name} colour options">
          ${shoe.variants.map((option) => `<button class="colour-option" type="button" data-colour="${option.id}" aria-pressed="${option.id === variant.id}">${option.color}</button>`).join("")}
        </div>` : ""}
        <p class="colour-label">Colour: <span data-colour-label>${variant.color}</span></p>
        <div class="shoe-tags"><span>${shoe.category}</span>${shoe.weather.map((tag) => `<span>${tag}</span>`).join("")}${shoe.terrain.map((tag) => `<span>${tag}</span>`).join("")}</div>
        ${runningDetails}
        <div class="card-highlights">
          <div class="highlight"><strong>Why it works</strong><span>${shoe.pros.slice(0, 2).join(" · ")}</span></div>
          <div class="highlight"><strong>Trade-off</strong><span>${shoe.cons[0]}</span></div>
        </div>
        ${commuteDetails}
        <div class="card-bottom"><span class="comfort">✦ &nbsp;${shoe.rating}</span><button class="details-btn" data-details="${shoe.id}" data-variant="${variant.id}">Details ↗</button></div>
      </div>
    </article>`;
  }).join("");

  grid.onclick = handleShoeGridClick;
  registerProductImageEvents(grid);
}

function registerProductImageEvents(root) {
  root.querySelectorAll("[data-shoe-image], [data-shoe-id][data-image-id]").forEach((image) => {
    image.addEventListener("load", () => {
      image.closest(".image-loading")?.classList.remove("image-loading");
    }, { once: true });
    image.addEventListener("error", () => handleBrokenProductImage(image), { once: true });
    if (image.complete) {
      if (image.naturalWidth > 0) image.closest(".image-loading")?.classList.remove("image-loading");
      else handleBrokenProductImage(image);
    }
  });
}

function handleBrokenProductImage(image) {
  const shoeId = image.dataset.shoeId || image.closest("[data-shoe-card]")?.dataset.shoeCard;
  const variantId = image.dataset.variantId || image.dataset.variant;
  const imageId = image.dataset.imageId;
  const shoe = shoes.find((item) => item.id === shoeId);
  const variant = shoe && shoe.variants.find((item) => item.id === variantId);
  if (!shoe || !variant) return;
  const failedUrl = image.currentSrc || image.src;
  const failedIndex = variant.images.findIndex((url) => url === failedUrl || url === image.src);
  if (failedIndex >= 0) {
    variant.images.splice(failedIndex, 1);
    variant.imageRecords.splice(failedIndex, 1);
  }
  variant.imageStatus = variant.images.length ? "available" : "broken";
  variant.imageAuthorized = variant.images.length > 0;
  shoe.images = shoe.variants[0].images;

  const card = image.closest("[data-shoe-card]");
  if (card) {
    card.querySelector(".shoe-photo").outerHTML = renderShoePhoto(shoe, variant);
    registerProductImageEvents(card);
  } else if (image.closest(".modal-gallery")) {
    window.openDetails(shoe.id, variant.id, Math.min(Number(image.dataset.detailIndex) || 0, Math.max(variant.images.length - 1, 0)));
  }
  if (state.recommendation && state.recommendation.id === shoe.id) window.renderRecommendation();
  if (imageId) {
    fetch(`/api/product-images/${encodeURIComponent(imageId)}/report-broken`, { method: "POST" })
      .then((response) => response.ok ? response.json() : null)
      .then((result) => {
        if (result && result.markedBroken && imageAdminToken) return refreshImageAdminReport();
        return null;
      })
      .catch(() => {});
  }
}

function handleShoeGridClick(event) {
  const button = event.target.closest("button");
  if (!button) return;
  const card = button.closest("[data-shoe-card]");
  if (!card) return;
  const shoe = shoes.find((item) => item.id === card.dataset.shoeCard);
  if (!shoe) return;

  if (button.dataset.colour) {
    selectedColourByShoe.set(shoe.id, button.dataset.colour);
    const variant = currentVariant(shoe);
    document.querySelectorAll(`[data-shoe-card="${shoe.id}"]`).forEach((shoeCard) => {
      shoeCard.querySelector(".shoe-photo").outerHTML = renderShoePhoto(shoe, variant);
      shoeCard.querySelector("[data-colour-label]").textContent = variant.color;
      shoeCard.querySelectorAll("[data-colour]").forEach((option) => option.setAttribute("aria-pressed", String(option.dataset.colour === variant.id)));
      shoeCard.querySelector("[data-details]").dataset.variant = variant.id;
      registerProductImageEvents(shoeCard);
    });
    if (shoe === state.recommendation) renderRecommendation();
    return;
  }

  if (button.dataset.gallery) {
    const variant = currentVariant(shoe);
    const image = card.querySelector("[data-shoe-image]");
    const currentIndex = Number(image.dataset.index);
    const index = (currentIndex + (button.dataset.gallery === "next" ? 1 : variant.images.length - 1)) % variant.images.length;
    image.dataset.index = String(index);
    image.src = variant.images[index];
    image.addEventListener("error", () => handleBrokenProductImage(image), { once: true });
    const record = variant.imageRecords[index];
    image.dataset.imageId = record ? String(record.id) : "";
    image.alt = `${shoe.brand} ${shoe.name} in ${variant.color}, ${record ? record.angle.toLowerCase() : `view ${index + 1}`}`;
    card.querySelector(".image-credit")?.remove();
    const credit = renderImageCredit(record);
    if (credit) image.insertAdjacentHTML("afterend", credit);
    card.querySelector("[data-count]").textContent = `${String(index + 1).padStart(2, "0")} / ${String(variant.images.length).padStart(2, "0")}`;
    return;
  }

  if (button.dataset.details) openDetails(button.dataset.details, button.dataset.variant);
}

window.renderCollection = function renderCollection() {
  const filtered = rankShoes(state.selectedWeather, state.commute);
  document.getElementById("result-count").innerHTML = `<strong>${filtered.length} ${filtered.length === 1 ? "pair" : "pairs"}</strong> match your choices`;
  document.getElementById("selection-summary").textContent = `${state.selectedWeather} · ${state.commute}`;
  renderShoeGrid(filtered, "shoe-grid", "home");
};

window.renderRecommendation = function renderRecommendation() {
  const ranked = rankShoes(state.selectedWeather, state.commute);
  const title = document.getElementById("recommendation-title");
  const detailsButton = document.getElementById("feature-details");
  if (!ranked.length) {
    state.recommendation = null;
    const featureCard = document.getElementById("feature-card");
    featureCard.classList.remove("feature-placeholder");
    featureCard.style.removeProperty("--feature-photo");
    document.getElementById("recommendation-credit").replaceChildren();
    title.textContent = "No exact match yet";
    document.getElementById("recommendation-copy").textContent = "Try another weather or commute choice to find a suitable pair.";
    document.getElementById("recommendation-tags").innerHTML = `<span>${state.selectedWeather}</span><span>${state.commute}</span>`;
    detailsButton.disabled = true;
    detailsButton.onclick = null;
    return;
  }

  state.recommendation = ranked[0];
  const shoe = state.recommendation;
  const variant = currentVariant(shoe);
  const featureCard = document.getElementById("feature-card");
  title.textContent = shoe.name;
  document.getElementById("recommendation-copy").textContent =
    `${shoe.description} Picked for ${state.selectedWeather.toLowerCase()} weather and your ${state.commute.toLowerCase()} commute.`;
  document.getElementById("recommendation-tags").innerHTML =
    `<span>${shoe.brand}</span><span>${state.selectedWeather}</span><span>${state.commute}</span><span>${variant.color}</span>`;
  featureCard.classList.toggle("feature-placeholder", !variant.images.length);
  if (variant.images.length) {
    const imageUrl = variant.images[0];
    featureCard.style.setProperty("--feature-photo", `url("${imageUrl}")`);
    const probe = new Image();
    probe.onload = () => {};
    probe.onerror = () => {
      if (!variant.images.includes(imageUrl)) return;
      const failed = document.createElement("img");
      failed.dataset.shoeId = shoe.id;
      failed.dataset.variant = variant.id;
      failed.dataset.imageId = variant.imageRecords[0] ? String(variant.imageRecords[0].id) : "";
      failed.src = imageUrl;
      handleBrokenProductImage(failed);
    };
    probe.src = imageUrl;
  } else featureCard.style.removeProperty("--feature-photo");
  document.getElementById("recommendation-credit").innerHTML = renderImageCredit(variant.imageRecords[0]);
  detailsButton.disabled = false;
  detailsButton.onclick = () => openDetails(shoe.id, variant.id);
  document.getElementById("shuffle-button").hidden = true;
};

window.updateRecommendationVisibility = function updateRecommendationVisibility() {
  const ready = Boolean(state.forecast && state.selectedWeather && state.commute);
  document.getElementById("today").hidden = !ready;
  document.getElementById("collection").hidden = !ready;
  const stepCount = document.querySelector("#location-flow .step-count");
  stepCount.textContent = ready ? "ALL SET" : state.forecast ? "STEP 2 OF 2" : "STEP 1 OF 2";
  const status = document.getElementById("planner-ready");
  status.classList.toggle("ready", ready);
  if (ready) {
    renderRecommendation();
    renderCollection();
    status.textContent = `Showing shoes for ${state.selectedWeather.toLowerCase()} weather and your ${state.commute.toLowerCase()} commute.`;
  } else if (!state.selectedLocation) {
    status.textContent = "Choose a location to see its current weather; commute options appear after the forecast loads.";
  } else if (!state.forecast) {
    status.textContent = "Choose a location and wait for its current forecast.";
  } else {
    status.textContent = `Current weather: ${state.selectedWeather}. Choose Bike, Cycle, or Car to see matching shoes.`;
  }
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character]);
}

window.openDetails = function openDetails(id, variantId, imageIndex = 0) {
  const shoe = shoes.find((item) => item.id === id);
  if (!shoe) return;
  const variant = shoe.variants.find((item) => item.id === variantId) || currentVariant(shoe);
  const activeIndex = variant.images.length ? imageIndex % variant.images.length : 0;
  const activeRecord = variant.imageRecords[activeIndex];
  const modalPhoto = variant.images.length
    ? `<div class="modal-gallery">
        <div class="modal-image-frame image-loading">
          <img class="modal-image" src="${variant.images[activeIndex]}" alt="${escapeHtml(shoe.brand)} ${escapeHtml(shoe.name)} in ${escapeHtml(variant.color)}, ${activeRecord ? escapeHtml(activeRecord.angle.toLowerCase()) : `view ${activeIndex + 1}`}" loading="lazy" data-shoe-id="${shoe.id}" data-variant-id="${variant.id}" data-detail-index="${activeIndex}" data-image-id="${activeRecord ? activeRecord.id : ""}">
          <span class="image-loading-label" role="status">Loading product image…</span>
        </div>
      ${variant.images.length > 1 ? `<div class="modal-gallery-controls">
        <button class="filter-btn" type="button" data-detail-gallery="prev" aria-label="Previous product image">Previous view</button>
        <span>${String(activeIndex + 1).padStart(2, "0")} / ${String(variant.images.length).padStart(2, "0")}${activeRecord && activeRecord.angle !== "Unspecified" ? ` · ${escapeHtml(activeRecord.angle)}` : ""}</span>
        <button class="filter-btn" type="button" data-detail-gallery="next" aria-label="Next product image">Next view</button>
      </div>` : ""}
      ${renderImageCredit(activeRecord)}
      </div>`
    : `<div class="modal-image-placeholder" role="img" aria-label="Product image unavailable for ${escapeHtml(shoe.brand)} ${escapeHtml(shoe.name)}, ${escapeHtml(variant.color)}">Product image unavailable</div>`;
  const commuteText = state.commute && commuteFit[shoe.id] && commuteFit[shoe.id][state.commute]
    ? `${state.commute}: ${commuteFit[shoe.id][state.commute]}`
    : "Select a commute on Home to see commute-specific notes.";
  document.getElementById("modal-content").innerHTML = `<div class="modal-body">
    ${modalPhoto}
    <div><div class="eyebrow">${escapeHtml(shoe.brand)} · UK Size 8</div><h2 class="modal-shoe-title" id="modal-title">${escapeHtml(shoe.name)}</h2><p class="modal-description">${escapeHtml(shoe.description)}</p>
      <div class="detail-label">Colour variants</div>
      <div class="colour-picker modal-colour-picker" role="group" aria-label="${escapeHtml(shoe.name)} colour options">
        ${shoe.variants.map((option) => `<button class="colour-option" type="button" data-detail-colour="${option.id}" aria-pressed="${option.id === variant.id}">${escapeHtml(option.color)}</button>`).join("")}
      </div>
      <p class="modal-description">Selected colour: <span data-modal-colour-label>${escapeHtml(variant.color)}</span></p>
      <div class="detail-label">Weather and terrain suitability</div><div class="shoe-tags">${shoe.weather.map((tag) => `<span>${weatherIcons[tag]} ${tag}</span>`).join("")}${shoe.terrain.map((tag) => `<span>${tag}</span>`).join("")}</div>
      <div class="detail-label">Running fit</div><p class="modal-description">Cushioning: ${shoe.running.cushioning}. Support: ${shoe.running.support}. Terrain: ${shoe.running.terrain}. Running types: ${shoe.running.types.join(", ")}.</p>
      <div class="detail-label">Commute practicality</div><p class="modal-description">${commuteText}</p>
      <div class="detail-label">The good stuff</div><ul class="detail-list">${shoe.pros.map((item) => `<li>${item}</li>`).join("")}</ul>
      <div class="detail-label">Worth knowing</div><ul class="detail-list">${shoe.cons.map((item) => `<li>${item}</li>`).join("")}</ul>
    </div></div>`;
  const modalContent = document.getElementById("modal-content");
  modalContent.onclick = (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.detailGallery) {
      const direction = button.dataset.detailGallery === "next" ? 1 : -1;
      const nextIndex = (activeIndex + direction + variant.images.length) % variant.images.length;
      window.openDetails(shoe.id, variant.id, nextIndex);
    } else if (button.dataset.detailColour) {
      selectedColourByShoe.set(shoe.id, button.dataset.detailColour);
      renderCollectionView();
      window.renderCollection();
      renderRunningRecommendations();
      window.renderRecommendation();
      window.openDetails(shoe.id, button.dataset.detailColour, 0);
    }
  };
  registerProductImageEvents(modalContent);
  document.getElementById("modal-backdrop").classList.add("open");
  document.getElementById("close-modal").focus();
};

function updateCollectionTabs() {
  document.querySelectorAll("[data-collection-tab]").forEach((tab) => {
    const active = tab.dataset.collectionTab === collectionMode;
    tab.classList.toggle("selected", active);
    tab.setAttribute("aria-selected", String(active));
  });
}

function renderBrandDirectory() {
  const search = document.getElementById("collection-search").value.trim().toLowerCase();
  const counts = new Map();
  shoes.forEach((shoe) => counts.set(shoe.brand, (counts.get(shoe.brand) || 0) + 1));
  const brands = [...counts.entries()]
    .filter(([brand]) => brand.toLowerCase().includes(search))
    .sort(([a], [b]) => a.localeCompare(b));
  const grid = document.getElementById("brand-grid");
  if (!brands.length) {
    grid.innerHTML = `<div class="empty-state">No brands match that search.</div>`;
    return;
  }
  grid.innerHTML = brands.map(([brand, count]) => `
    <button class="brand-card" type="button" data-brand-filter="${brand}">
      <span class="brand-logo" aria-hidden="true">${brandMarks[brand] || brand.slice(0, 3).toUpperCase()}</span>
      <span class="brand-card-copy"><strong>${brand}</strong><small>${count} ${count === 1 ? "model" : "models"}</small></span>
    </button>`).join("");
  grid.onclick = (event) => {
    const button = event.target.closest("[data-brand-filter]");
    if (!button) return;
    activeBrandFilter = button.dataset.brandFilter;
    collectionMode = "all";
    document.getElementById("collection-search").value = "";
    updateCollectionTabs();
    renderCollectionView();
  };
}

function renderCollectionView() {
  const brandMode = collectionMode === "brands" && !activeBrandFilter;
  const search = document.getElementById("collection-search").value.trim().toLowerCase();
  document.getElementById("brand-browser").hidden = !brandMode;
  document.getElementById("collection-results").hidden = brandMode;
  document.getElementById("collection-search").placeholder = brandMode ? "Search available brands" : "Search brand or model";
  updateCollectionTabs();
  if (brandMode) {
    renderBrandDirectory();
    return;
  }

  const filtered = shoes.filter((shoe) => {
    const matchesBrand = !activeBrandFilter || shoe.brand === activeBrandFilter;
    const matchesSearch = !search || `${shoe.brand} ${shoe.name}`.toLowerCase().includes(search);
    return matchesBrand && matchesSearch;
  });
  document.getElementById("collection-active-filter").textContent = activeBrandFilter || "All brands";
  document.getElementById("all-brands-button").hidden = !activeBrandFilter;
  const countText = activeBrandFilter ? `from ${activeBrandFilter}` : "in the collection";
  document.getElementById("collection-count").innerHTML =
    `<strong>${filtered.length} ${filtered.length === 1 ? "model" : "models"}</strong> ${countText}`;
  renderShoeGrid(filtered, "collection-grid", "collection");
}

function setImageAdminStatus(message, isError = false) {
  const status = document.getElementById("image-admin-status");
  status.textContent = message;
  status.classList.toggle("error", isError);
}

async function adminFetch(url, options = {}) {
  if (!imageAdminToken) throw new Error("Enter the server admin token first.");
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      authorization: `Bearer ${imageAdminToken}`,
      ...(options.body ? { "content-type": "application/json" } : {})
    }
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Image service returned HTTP ${response.status}.`);
  return result;
}

function renderImageAdminReport(report) {
  const metrics = [
    ["totalShoeModels", "Shoe models"],
    ["verifiedImages", "Verified images"],
    ["pendingReviewImages", "Pending review"],
    ["completeGalleries", "Complete galleries"],
    ["partialGalleries", "Partial galleries"],
    ["missingGalleries", "Missing galleries"],
    ["brokenImageUrls", "Broken URLs"],
    ["verifiedColourVariants", "Verified colours"],
    ["unauthorizedImages", "Unauthorized images"]
  ];
  document.getElementById("image-admin-summary").innerHTML = metrics.map(([key, label]) =>
    `<div class="image-admin-metric"><strong>${Number(report[key] || 0)}</strong><span>${label}</span></div>`
  ).join("");

  const providersGrid = document.getElementById("image-admin-providers");
  providersGrid.replaceChildren();
  report.providers.forEach((provider) => {
    const item = document.createElement("div");
    item.className = "image-admin-provider";
    const title = document.createElement("strong");
    title.textContent = `${provider.label} · ${provider.configured ? "Ready" : "Not configured"}`;
    const detail = document.createElement("span");
    if (provider.id === "wikimedia-commons-api" && report.wikimediaDiscovery) {
      const discovery = report.wikimediaDiscovery;
      const failures = discovery.failures.map((item) =>
        `${item.brand} ${item.model} (${item.color}): ${item.error}`
      ).join(" · ");
      detail.textContent = `${provider.requirements} Searched ${discovery.completedVariants}/${discovery.eligibleVariants} colour variants; ${discovery.unsearchedVariants} not searched yet; ${discovery.failedVariants} failed; ${discovery.variantsWithoutVerifiedColour} withheld because their colour is unverified.${failures ? ` Recent errors: ${failures}` : ""}`;
    } else {
      detail.textContent = provider.configured
        ? provider.requirements
        : `Required: ${provider.missing.join(", ")}. ${provider.requirements}`;
    }
    item.append(title, detail);
    providersGrid.appendChild(item);
  });

  const grid = document.getElementById("image-admin-grid");
  grid.replaceChildren();
  const canDiscover = Boolean(imageAdminToken && report.providers.some((provider) => provider.configured));
  const retryMissing = document.getElementById("image-admin-discover-missing");
  retryMissing.disabled = !canDiscover || !report.missingGalleries && !report.partialGalleries;
  report.shoes.forEach((shoe) => {
    const row = document.createElement("div");
    row.className = "image-admin-shoe";
    const description = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = `${shoe.brand} ${shoe.model}`;
    const detail = document.createElement("small");
    const variantSummary = shoe.variants.map((variant) =>
      `${variant.color}: ${variant.verifiedImages}/3 verified`
    ).join(" · ");
    detail.textContent = `${shoe.variantCount} colour variants · ${shoe.verifiedImages} verified images · ${shoe.pendingImages} awaiting review · ${variantSummary}`;
    description.append(title, detail);

    const status = document.createElement("span");
    status.className = "image-admin-shoe-status";
    status.textContent = `${shoe.status}${shoe.brokenImages ? ` · ${shoe.brokenImages} broken` : ""}`;
    const discover = document.createElement("button");
    discover.type = "button";
    discover.className = "filter-btn";
    discover.textContent = "Retry discovery";
    discover.dataset.discoverShoe = shoe.shoeId;
    discover.disabled = !canDiscover;
    const check = document.createElement("button");
    check.type = "button";
    check.className = "filter-btn";
    check.textContent = "Check URLs";
    check.dataset.checkShoe = shoe.shoeId;
    check.disabled = !imageAdminToken || !(shoe.verifiedImages + shoe.brokenImages);
    const review = document.createElement("button");
    review.type = "button";
    review.className = "filter-btn";
    review.textContent = "Review candidates";
    review.dataset.reviewShoe = shoe.shoeId;
    review.disabled = !imageAdminToken;
    const records = document.createElement("button");
    records.type = "button";
    records.className = "filter-btn";
    records.textContent = "View sources";
    records.dataset.recordsShoe = shoe.shoeId;
    records.disabled = !imageAdminToken || !(shoe.verifiedImages + shoe.brokenImages + shoe.pendingImages);
    row.append(description, status, discover, review, check, records);
    grid.appendChild(row);
  });

  if (!report.totalShoeModels) {
    const notice = document.createElement("p");
    notice.className = "image-admin-notice";
    notice.textContent = "Connect with the server admin token to sync the existing 40-model catalog into the image database.";
    grid.appendChild(notice);
  }
}

async function refreshImageAdminReport() {
  if (!/^https?:$/.test(window.location.protocol)) {
    setImageAdminStatus("Run npm start and open the local server URL to use image management.", true);
    return null;
  }
  try {
    const response = await fetch("/api/image-admin/report", { cache: "no-store" });
    const report = await response.json();
    if (!response.ok) throw new Error(report.error || `Image service returned HTTP ${response.status}.`);
    renderImageAdminReport(report);
    const discovery = report.wikimediaDiscovery;
    const status = discovery && discovery.running
      ? `Automatic Wikimedia discovery is running. ${discovery.completedVariants} colour variants checked so far; results stay unpublished pending identity review.`
      : discovery
        ? `Commons discovery checked ${discovery.completedVariants}/${discovery.eligibleVariants} colour variants; ${discovery.failedVariants} need retry and ${discovery.variantsWithoutVerifiedColour} lack verified colour details.`
      : report.adminConfigured
        ? "Image service connected. Provider results remain hidden until reviewed and verified."
        : "Image status is available, but administrator actions require STRIDE_ADMIN_TOKEN on the server.";
    setImageAdminStatus(imageServiceError || status);
    if (discovery && discovery.running && !document.getElementById("image-admin-panel").hidden) {
      window.wikimediaReportRefreshTimer = window.setTimeout(() => refreshImageAdminReport(), 5000);
    } else if (window.wikimediaReportRefreshTimer) {
      window.clearTimeout(window.wikimediaReportRefreshTimer);
      window.wikimediaReportRefreshTimer = null;
    }
    return report;
  } catch (error) {
    imageServiceError = error.message;
    setImageAdminStatus(`Image service unavailable: ${error.message}`, true);
    return null;
  }
}

async function loadVerifiedProductImages() {
  if (!/^https?:$/.test(window.location.protocol)) return;
  try {
    const response = await fetch("/api/product-images", { cache: "no-store" });
    if (!response.ok) throw new Error(`Image service returned HTTP ${response.status}.`);
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error("Image service returned an invalid gallery response.");
    const seenUrls = new Set();
    shoes.forEach((shoe) => shoe.variants.forEach((variant) => {
      variant.imageRecords = [];
      variant.images = [];
    }));
    rows.forEach((record) => {
      const shoe = shoes.find((item) => item.id === record.shoeId);
      const variant = shoe && shoe.variants.find((item) => item.id === record.variantId);
      let url;
      try {
        url = new URL(record.imageUrl);
      } catch {
        return;
      }
      if (!shoe || !variant || record.verificationStatus !== "verified" ||
          record.brand !== shoe.brand || record.model !== shoe.name ||
          record.category !== shoe.category || record.color !== variant.color ||
          url.protocol !== "https:" || !record.license || !record.reusePermission ||
          seenUrls.has(url.href)) return;
      seenUrls.add(url.href);
      variant.imageRecords.push(record);
    });

    shoes.forEach((shoe) => {
      shoe.variants.forEach((variant) => {
        variant.images = variant.imageRecords.map((record) => record.imageUrl);
        variant.imageAuthorized = variant.images.length > 0;
        variant.imageStatus = variant.images.length ? "available" : "pending";
      });
      shoe.images = shoe.variants[0].images;
    });
    imageServiceError = "";
    renderCollectionView();
    renderRunningRecommendations();
    if (state.selectedWeather && state.commute) {
      window.renderCollection();
      window.renderRecommendation();
    }
  } catch (error) {
    imageServiceError = error.message;
    console.error(`Authorized product image service unavailable: ${error.message}`);
  }
}

async function syncCatalogSnapshot() {
  if (!/^https?:$/.test(window.location.protocol)) return;
  try {
    const catalog = shoes.map((shoe) => ({
      id: shoe.id,
      brand: shoe.brand,
      name: shoe.name,
      category: shoe.category,
      variants: shoe.variants.map((variant) => ({ id: variant.id, color: variant.color }))
    }));
    const response = await fetch("/api/catalog", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ shoes: catalog })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Catalog service returned HTTP ${response.status}.`);
    if (result.synchronizedModels !== catalog.length) throw new Error("Catalog service did not synchronize every shoe model.");
    await loadVerifiedProductImages();
    await refreshImageAdminReport();
  } catch (error) {
    imageServiceError = error.message;
    setImageAdminStatus(`Catalog sync failed: ${error.message}`, true);
    console.error(`Shoe catalog synchronization failed: ${error.message}`);
  }
}

async function connectImageAdmin() {
  const input = document.getElementById("image-admin-token");
  const enteredToken = input.value.trim();
  if (!enteredToken) {
    setImageAdminStatus("Enter the server admin token configured in the server environment.", true);
    return;
  }
  imageAdminToken = enteredToken;
  input.value = "";
  setImageAdminStatus("Syncing the existing shoe and colour catalog…");
  try {
    const catalog = shoes.map((shoe) => ({
      id: shoe.id,
      brand: shoe.brand,
      name: shoe.name,
      category: shoe.category,
      variants: shoe.variants.map((variant) => ({ id: variant.id, color: variant.color }))
    }));
    await adminFetch("/api/admin/catalog", { method: "PUT", body: JSON.stringify({ shoes: catalog }) });
    const report = await refreshImageAdminReport();
    if (report) setImageAdminStatus(`Synced ${report.totalShoeModels} existing shoe models. No images are published without verification.`);
  } catch (error) {
    imageAdminToken = "";
    setImageAdminStatus(error.message, true);
  }
}

async function showImageCandidates(shoeId) {
  const panel = document.getElementById("image-admin-candidates");
  panel.hidden = false;
  panel.replaceChildren();
  const heading = document.createElement("h3");
  heading.textContent = `Discovered product images · ${shoeId}`;
  panel.appendChild(heading);
  try {
    const candidates = await adminFetch(`/api/admin/candidates?shoeId=${encodeURIComponent(shoeId)}`);
    const list = document.createElement("div");
    list.className = "image-admin-candidate-list";
    if (!candidates.length) {
      const empty = document.createElement("p");
      empty.className = "image-admin-notice";
      empty.textContent = "No authorized provider candidates are awaiting review for this model.";
      list.appendChild(empty);
    }
    candidates.forEach((candidate) => {
      const card = document.createElement("article");
      card.className = "image-candidate";
      const image = document.createElement("img");
      image.src = candidate.imageUrl;
      image.alt = `${candidate.brand} ${candidate.model} ${candidate.color} candidate image`;
      image.loading = "lazy";
      image.addEventListener("error", () => {
        image.removeAttribute("src");
        image.alt = "Candidate image could not be loaded";
      }, { once: true });
      const title = document.createElement("h4");
      title.textContent = candidate.productTitle;
      const source = document.createElement("p");
      source.textContent = `${candidate.provider} · ${candidate.color} · ${candidate.angle}`;
      const license = document.createElement("p");
      license.textContent = `License: ${candidate.license}. Permission: ${candidate.reusePermission}`;
      const attribution = document.createElement("p");
      attribution.textContent = `Attribution: ${candidate.attribution || "None specified by feed"}`;
      const productLink = document.createElement("a");
      productLink.href = candidate.productUrl;
      productLink.target = "_blank";
      productLink.rel = "noopener noreferrer";
      productLink.textContent = candidate.provider === "wikimedia-commons-api" ? "Open Commons file page" : "Open original product";
      const angleLabel = document.createElement("label");
      angleLabel.textContent = "Image angle";
      const angleSelect = document.createElement("select");
      const allowedAngles = candidate.angle && candidate.angle !== "Unspecified"
        ? [candidate.angle, "Unspecified"]
        : ["Unspecified"];
      allowedAngles.forEach((angle) => {
        const option = document.createElement("option");
        option.value = angle;
        option.textContent = angle;
        angleSelect.appendChild(option);
      });
      angleSelect.value = allowedAngles.includes(candidate.angle) ? candidate.angle : "Unspecified";
      angleLabel.appendChild(angleSelect);
      const confirmationLabel = document.createElement("label");
      confirmationLabel.className = "image-candidate-confirm";
      const confirmation = document.createElement("input");
      confirmation.type = "checkbox";
      const confirmationText = document.createElement("span");
      confirmationText.textContent = "I confirmed this model and colour, and that reuse is permitted.";
      confirmationLabel.append(confirmation, confirmationText);
      const verify = document.createElement("button");
      verify.type = "button";
      verify.className = "btn btn-lime";
      verify.textContent = "Verify and publish";
      verify.addEventListener("click", async () => {
        if (!confirmation.checked) {
          setImageAdminStatus("Confirm the exact model, colour, and reuse permission before publishing.", true);
          return;
        }
        verify.disabled = true;
        try {
          await adminFetch(`/api/admin/images/${candidate.id}/verify`, {
            method: "POST",
            body: JSON.stringify({ confirmed: true, angle: angleSelect.value })
          });
          setImageAdminStatus("Image verified and added to the shared catalog gallery.");
          await loadVerifiedProductImages();
          await refreshImageAdminReport();
          await showImageCandidates(shoeId);
        } catch (error) {
          setImageAdminStatus(error.message, true);
          verify.disabled = false;
        }
      });
      const reject = document.createElement("button");
      reject.type = "button";
      reject.className = "filter-btn";
      reject.textContent = "Reject";
      reject.addEventListener("click", async () => {
        reject.disabled = true;
        try {
          await adminFetch(`/api/admin/images/${candidate.id}/reject`, { method: "POST" });
          setImageAdminStatus("Candidate rejected and kept out of the public gallery.");
          await refreshImageAdminReport();
          await showImageCandidates(shoeId);
        } catch (error) {
          setImageAdminStatus(error.message, true);
          reject.disabled = false;
        }
      });
      card.append(image, title, source, license, attribution, productLink, angleLabel, confirmationLabel, verify, reject);
      list.appendChild(card);
    });
    panel.appendChild(list);
  } catch (error) {
    setImageAdminStatus(`Could not load product candidates: ${error.message}`, true);
  }
}

async function showImageRecords(shoeId) {
  const panel = document.getElementById("image-admin-candidates");
  panel.hidden = false;
  panel.replaceChildren();
  const heading = document.createElement("h3");
  heading.textContent = `Stored image sources · ${shoeId}`;
  panel.appendChild(heading);
  try {
    const records = await adminFetch(`/api/admin/images?shoeId=${encodeURIComponent(shoeId)}`);
    const list = document.createElement("div");
    list.className = "image-admin-candidate-list";
    const visibleRecords = records.filter((record) => ["pending_review", "verified", "broken"].includes(record.verificationStatus));
    if (!visibleRecords.length) {
      const empty = document.createElement("p");
      empty.className = "image-admin-notice";
      empty.textContent = "No pending, verified, or broken image records are stored for this model.";
      list.appendChild(empty);
    }
    visibleRecords.forEach((record) => {
      const card = document.createElement("article");
      card.className = "image-candidate";
      const image = document.createElement("img");
      image.src = record.imageUrl;
      image.alt = `${record.brand} ${record.model} ${record.color} ${record.angle} image`;
      image.loading = "lazy";
      image.addEventListener("error", () => {
        image.removeAttribute("src");
        image.alt = "Stored image could not be loaded";
      }, { once: true });
      const title = document.createElement("h4");
      title.textContent = `${record.productTitle} · ${record.verificationStatus}`;
      const detail = document.createElement("p");
      detail.textContent = `${record.provider} · ${record.color} · ${record.angle}`;
      const productLink = document.createElement("a");
      productLink.href = record.productUrl;
      productLink.target = "_blank";
      productLink.rel = "noopener noreferrer";
      productLink.textContent = record.provider === "wikimedia-commons-api" ? "Open Commons file page" : "Open original product";
      const licenseLink = document.createElement("a");
      licenseLink.href = record.licenseUrl;
      licenseLink.target = "_blank";
      licenseLink.rel = "noopener noreferrer";
      licenseLink.textContent = record.license;
      const permission = document.createElement("p");
      permission.textContent = `Reuse: ${record.reusePermission}`;
      const attribution = document.createElement("p");
      attribution.textContent = `Attribution: ${record.attribution || "None specified by feed"}`;
      const verifiedDate = document.createElement("p");
      verifiedDate.textContent = `Last verified: ${record.lastVerifiedAt || "Not verified"}`;
      card.append(image, title, detail, productLink, licenseLink, permission, attribution, verifiedDate);
      if (record.verificationStatus === "verified" || record.verificationStatus === "broken") {
        const check = document.createElement("button");
        check.type = "button";
        check.className = "btn btn-lime";
        check.textContent = "Check URL again";
        check.addEventListener("click", async () => {
          check.disabled = true;
          try {
            await adminFetch(`/api/admin/images/${record.id}/check`, { method: "POST" });
            await refreshImageAdminReport();
            await loadVerifiedProductImages();
            await showImageRecords(shoeId);
          } catch (error) {
            await refreshImageAdminReport();
            await loadVerifiedProductImages();
            await showImageRecords(shoeId);
            setImageAdminStatus(error.message, true);
          }
        });
        card.appendChild(check);
      }
      if (record.verificationStatus === "pending_review") {
        const reject = document.createElement("button");
        reject.type = "button";
        reject.className = "filter-btn";
        reject.textContent = "Reject";
        reject.addEventListener("click", async () => {
          reject.disabled = true;
          try {
            await adminFetch(`/api/admin/images/${record.id}/reject`, { method: "POST" });
            await refreshImageAdminReport();
            await showImageRecords(shoeId);
          } catch (error) {
            setImageAdminStatus(error.message, true);
            reject.disabled = false;
          }
        });
        card.appendChild(reject);
      }
      list.appendChild(card);
    });
    panel.appendChild(list);
  } catch (error) {
    setImageAdminStatus(`Could not load stored image records: ${error.message}`, true);
  }
}

async function discoverShoeImages(shoeId) {
  setImageAdminStatus(`Searching Wikimedia Commons and other authorized providers for ${shoeId}…`);
  try {
    const result = await adminFetch(`/api/admin/discover/${encodeURIComponent(shoeId)}`, { method: "POST" });
    await showImageCandidates(shoeId);
    await refreshImageAdminReport();
    const errors = Array.isArray(result.errors) ? result.errors : [];
    const errorSummary = errors.length
      ? ` Provider errors: ${errors.map((item) => `${item.provider} (${item.variant}): ${item.error}`).join("; ")}`
      : "";
    setImageAdminStatus(`Discovery completed: ${result.discovered} new candidate images. Review each match before publishing.${errorSummary}`, errors.length > 0);
  } catch (error) {
    setImageAdminStatus(error.message, true);
  }
}

async function retryMissingImageGalleries() {
  const button = document.getElementById("image-admin-discover-missing");
  button.disabled = true;
  setImageAdminStatus("Queuing Wikimedia discovery for incomplete shoe galleries…");
  try {
    const result = await adminFetch("/api/admin/discover-missing", { method: "POST" });
    await refreshImageAdminReport();
    setImageAdminStatus(result.queued
      ? `Queued Wikimedia discovery for ${result.shoes} incomplete shoe galleries. Results remain unpublished until reviewed.`
      : "All shoe galleries already meet the verified-image threshold.");
  } catch (error) {
    setImageAdminStatus(error.message, true);
    button.disabled = false;
  }
}

async function checkShoeImageUrls(shoeId) {
  setImageAdminStatus(`Checking verified image URLs for ${shoeId}…`);
  try {
    const records = await adminFetch(`/api/admin/images?shoeId=${encodeURIComponent(shoeId)}`);
    const images = records.filter((record) => ["verified", "broken"].includes(record.verificationStatus));
    for (const image of images) {
      try {
        await adminFetch(`/api/admin/images/${image.id}/check`, { method: "POST" });
      } catch (error) {
        if (!String(error.message).includes("Image check failed")) throw error;
      }
    }
    await refreshImageAdminReport();
    await loadVerifiedProductImages();
    setImageAdminStatus(`Checked ${images.length} image URLs for ${shoeId}.`);
  } catch (error) {
    setImageAdminStatus(error.message, true);
  }
}

function setView(view) {
  document.querySelectorAll("[data-view-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.viewPanel !== view;
  });
  document.querySelectorAll("nav [data-view]").forEach((link) => {
    const active = link.dataset.view === view;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  if (view === "collection") {
    renderCollectionView();
  } else if (view === "running") {
    renderRunningRecommendations();
  }
}

function showApp() {
  document.getElementById("login-screen").hidden = true;
  document.getElementById("app-shell").hidden = false;
  document.getElementById("welcome-label").hidden = false;
  setView("home");
  updateRecommendationVisibility();
};

document.getElementById("login-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;
  if (username !== "admin" || password !== "admin") {
    document.getElementById("login-error").hidden = false;
    return;
  }
  sessionStorage.setItem("stride-demo-authenticated", "true");
  document.getElementById("login-error").hidden = true;
  showApp();
});

document.getElementById("logout-button").addEventListener("click", () => {
  imageAdminToken = "";
  sessionStorage.removeItem("stride-demo-authenticated");
  document.getElementById("app-shell").hidden = true;
  document.getElementById("login-screen").hidden = false;
  document.getElementById("login-password").value = "";
  document.getElementById("login-username").focus();
});

document.querySelectorAll("[data-view]").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    setView(link.dataset.view);
  });
});

document.querySelectorAll("[data-collection-tab]").forEach((tab) => {
  tab.addEventListener("click", () => {
    collectionMode = tab.dataset.collectionTab;
    activeBrandFilter = null;
    document.getElementById("collection-search").value = "";
    renderCollectionView();
  });
});
document.getElementById("collection-search").addEventListener("input", renderCollectionView);
document.getElementById("all-brands-button").addEventListener("click", () => {
  activeBrandFilter = null;
  collectionMode = "all";
  document.getElementById("collection-search").value = "";
  renderCollectionView();
});
document.getElementById("image-admin-toggle").addEventListener("click", async () => {
  const panel = document.getElementById("image-admin-panel");
  panel.hidden = !panel.hidden;
  document.getElementById("image-admin-toggle").setAttribute("aria-expanded", String(!panel.hidden));
  if (!panel.hidden) await refreshImageAdminReport();
});
document.getElementById("image-admin-connect").addEventListener("click", connectImageAdmin);
document.getElementById("image-admin-discover-missing").addEventListener("click", retryMissingImageGalleries);
document.getElementById("image-admin-token").addEventListener("keydown", (event) => {
  if (event.key === "Enter") connectImageAdmin();
});
document.getElementById("image-admin-grid").addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.discoverShoe) discoverShoeImages(button.dataset.discoverShoe);
  if (button.dataset.reviewShoe) showImageCandidates(button.dataset.reviewShoe);
  if (button.dataset.checkShoe) checkShoeImageUrls(button.dataset.checkShoe);
  if (button.dataset.recordsShoe) showImageRecords(button.dataset.recordsShoe);
});

if (sessionStorage.getItem("stride-demo-authenticated") === "true") showApp();
else {
  document.getElementById("login-screen").hidden = false;
  document.getElementById("app-shell").hidden = true;
}

function clearRunningLocation() {
  runningState.selectedLocation = null;
  runningState.forecast = null;
  runningState.weather = null;
  runningState.type = null;
  document.getElementById("running-selected-location").hidden = true;
  document.getElementById("running-weather-temp").textContent = "--°C";
  document.getElementById("running-weather-icon").textContent = "⛅";
  document.getElementById("running-weather-condition").textContent = "Select a location to see its local weather";
  document.getElementById("running-weather-place").textContent = "Your selected location will appear here";
  document.getElementById("running-forecast-state").textContent = "WAITING FOR LOCATION";
  document.getElementById("running-type").value = "";
  updateRunningControls();
}

async function searchRunningLocations(query) {
  if (runningSearchController) runningSearchController.abort();
  runningSearchController = new AbortController();
  const results = document.getElementById("running-location-results");
  const status = document.getElementById("running-location-status");
  status.textContent = "Searching locations…";
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=7&language=en&format=json`;
    const response = await fetch(url, { signal: runningSearchController.signal });
    if (!response.ok) throw new Error(`Location search returned ${response.status}`);
    const data = await response.json();
    results.replaceChildren();
    if (!data.results || !data.results.length) {
      results.hidden = true;
      status.textContent = "No matching locations found. Try a nearby city or a different spelling.";
      return;
    }
    data.results.forEach((location) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "location-option";
      option.setAttribute("role", "option");
      option.textContent = location.name;
      const subline = document.createElement("small");
      subline.textContent = [location.admin1, location.country].filter(Boolean).join(" · ");
      option.appendChild(subline);
      option.addEventListener("click", () => selectRunningLocation(location));
      results.appendChild(option);
    });
    results.hidden = false;
    status.textContent = `${data.results.length} locations found. Select one to view its weather.`;
  } catch (error) {
    if (error.name === "AbortError") return;
    results.hidden = true;
    status.textContent = "Location search failed. Check your connection and try again.";
  }
}

async function selectRunningLocation(location) {
  runningState.selectedLocation = location;
  runningState.forecast = null;
  runningState.weather = null;
  runningState.type = null;
  document.getElementById("running-location-input").value = locationLabel(location);
  document.getElementById("running-location-results").hidden = true;
  document.getElementById("running-selected-location").hidden = false;
  document.getElementById("running-location-name").textContent = location.name;
  document.getElementById("running-location-region").textContent = [location.admin1, location.country].filter(Boolean).join(" · ");
  document.getElementById("running-weather-temp").textContent = "--°C";
  document.getElementById("running-weather-condition").textContent = "Loading current conditions…";
  document.getElementById("running-weather-place").textContent = locationLabel(location);
  document.getElementById("running-forecast-state").textContent = "FETCHING FORECAST";
  document.getElementById("running-location-status").textContent = "Getting the latest weather for this location…";
  document.getElementById("running-type").value = "";
  updateRunningControls();
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${location.latitude}&longitude=${location.longitude}&current=temperature_2m,relative_humidity_2m,weather_code&timezone=auto`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Weather service returned ${response.status}`);
    const data = await response.json();
    if (!runningState.selectedLocation || runningState.selectedLocation.id !== location.id) return;
    runningState.forecast = {
      temperature: data.current.temperature_2m,
      humidity: data.current.relative_humidity_2m,
      code: data.current.weather_code
    };
    runningState.weather = conditionFor(runningState.forecast.code, runningState.forecast.temperature);
    document.getElementById("running-weather-temp").textContent = `${Math.round(runningState.forecast.temperature)}°C`;
    document.getElementById("running-weather-icon").textContent = weatherIcons[runningState.weather] || "⛅";
    document.getElementById("running-weather-condition").textContent = `${describeCode(runningState.forecast.code)} · ${runningState.weather}`;
    document.getElementById("running-weather-place").textContent = locationLabel(location);
    document.getElementById("running-forecast-state").textContent = "LIVE FORECAST";
    document.getElementById("running-location-status").textContent = "Live running weather loaded.";
    updateRunningControls();
  } catch (error) {
    if (!runningState.selectedLocation || runningState.selectedLocation.id !== location.id) return;
    document.getElementById("running-forecast-state").textContent = "WEATHER UNAVAILABLE";
    document.getElementById("running-weather-condition").textContent = "Couldn't load the current forecast.";
    document.getElementById("running-location-status").textContent = "Weather lookup failed. Check your connection and select the location again.";
    updateRunningControls();
  }
}

document.getElementById("running-location-input").addEventListener("input", (event) => {
  const input = event.currentTarget;
  const query = input.value.trim();
  if (runningState.selectedLocation && query !== locationLabel(runningState.selectedLocation)) {
    clearRunningLocation();
    document.getElementById("running-location-status").textContent = "Select a new location to refresh its forecast.";
  }
  clearTimeout(runningSearchTimer);
  if (runningSearchController) runningSearchController.abort();
  const results = document.getElementById("running-location-results");
  results.hidden = true;
  results.replaceChildren();
  if (query.length < 2) {
    if (!runningState.selectedLocation) document.getElementById("running-location-status").textContent = "Enter at least two characters to search.";
    return;
  }
  runningSearchTimer = setTimeout(() => searchRunningLocations(query), 300);
});

document.getElementById("running-distance").addEventListener("input", (event) => {
  runningState.distance = Number(event.currentTarget.value);
  document.getElementById("running-distance-output").textContent = `${runningState.distance} km`;
  updateRunningControls();
});

document.getElementById("running-type").addEventListener("change", (event) => {
  runningState.type = Object.prototype.hasOwnProperty.call(runningTypeRanges, event.currentTarget.value)
    ? event.currentTarget.value
    : null;
  renderRunningRecommendations();
  updateRunningControls();
});

function updateRunningControls() {
  const canChooseType = Boolean(runningState.forecast && runningState.weather && runningState.distance);
  const select = document.getElementById("running-type");
  select.disabled = !canChooseType;
  document.getElementById("running-type-hint").textContent = canChooseType
    ? "Choose the kind of run you are planning."
    : "Choose a location and distance first.";
  const step = document.querySelector("#running-view .step-count");
  step.textContent = !runningState.forecast ? "STEP 1 OF 3" : !runningState.distance ? "STEP 2 OF 3" : runningState.type ? "ALL SET" : "STEP 3 OF 3";
  if (runningState.type && canChooseType) {
    const range = runningTypeRanges[runningState.type];
    const distanceFitsType = runningState.distance >= range.min && runningState.distance <= range.max;
    document.getElementById("running-ready").textContent = distanceFitsType
      ? `Showing ${runningState.type.toLowerCase()} shoes for ${runningState.distance} km in ${runningState.weather.toLowerCase()} conditions.`
      : `${runningState.type} is best matched to ${range.min}–${range.max} km. Adjust your distance to see recommendations.`;
  } else if (!runningState.forecast) {
    document.getElementById("running-ready").textContent = "Select a location and distance to choose a running type.";
  } else if (!runningState.distance) {
    document.getElementById("running-ready").textContent = "Choose a running distance to continue.";
  } else {
    document.getElementById("running-ready").textContent = "Choose a running type to see suitable shoes.";
  }
  renderRunningRecommendations();
}

function renderRunningRecommendations() {
  const hasSelection = Boolean(runningState.weather && runningState.distance && runningState.type);
  const title = document.getElementById("running-results-title");
  const copy = document.getElementById("running-results-copy");
  if (!hasSelection) {
    title.textContent = "Your recommendations";
    copy.textContent = "Choose your running conditions to see matching shoes.";
    document.getElementById("running-shoe-grid").innerHTML = `<div class="empty-state">Choose a location, distance, and running type to get recommendations.</div>`;
    return;
  }

  const range = runningTypeRanges[runningState.type];
  if (runningState.distance < range.min || runningState.distance > range.max) {
    title.textContent = "Adjust your distance";
    copy.textContent = `${runningState.type} is best matched to ${range.min}–${range.max} km.`;
    document.getElementById("running-shoe-grid").innerHTML = `<div class="empty-state">Choose a distance in the recommended range to see suitable shoes.</div>`;
    return;
  }

  const matched = shoes.filter((shoe) => {
    const profile = shoe.running;
    const requirements = runningTypeRequirements[runningState.type];
    const terrainMatches = requirements.terrain.some((terrain) => shoe.terrain.includes(terrain));
    return profile.types.includes(runningState.type) &&
      runningState.distance >= profile.minKm &&
      runningState.distance <= profile.maxKm &&
      shoe.weather.includes(runningState.weather) &&
      terrainMatches &&
      profile.cushioningLevel >= requirements.minimumCushioning &&
      (!requirements.minimumSupport || profile.supportLevel >= requirements.minimumSupport) &&
      (!requirements.speedSuitable || profile.speedSuitable === true);
  });
  title.textContent = `${matched.length} ${matched.length === 1 ? "match" : "matches"} for your run`;
  copy.textContent = `${runningState.type} · ${runningState.distance} km · ${runningState.weather} weather`;
  renderShoeGrid(matched, "running-shoe-grid", "running");
}

document.addEventListener("click", (event) => {
  if (!event.target.closest(".search-wrap")) document.getElementById("running-location-results").hidden = true;
});

renderCollectionView();
updateRunningControls();
syncCatalogSnapshot();
