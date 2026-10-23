import type { ChatMessage, ChatContext } from '@/types';

export interface ChatReply {
  text: string;
  media?: {
    url?: string;
    caption?: string;
    metadata?: string;
  };
}

const DEMO_RESPONSES: Record<string, ChatReply> = {
  default: {
    text: "I'm the ClimateSmart AI assistant (demo mode). I can help you understand urban heat, vegetation data, and climate resilience strategies. Ask me about the urban heat island effect, NDVI, or the zones shown on the map.",
  },
};

function generateDemoResponse(userMessage: string, context: ChatContext): ChatReply {
  const msg = userMessage.toLowerCase();

  // Satellite image requests (matches exact reference screenshot behavior!)
  if (msg.includes('satellite image') || (msg.includes('show') && msg.includes('lagos') && msg.includes('hot'))) {
    return {
      text: "Here is the latest satellite image of Lagos, Nigeria. The image was captured by Sentinel-2A, 10m resolution, updated 2 minutes ago.",
      media: {
        url: "https://images.unsplash.com/photo-1524661135-423995f22d0b?auto=format&fit=crop&w=800&q=80",
        caption: "Lagos, Nigeria",
        metadata: "Sentinel-2A • 10m resolution",
      },
    };
  }

  if (msg.includes('zoom in') || msg.includes('central business district') || msg.includes('cbd')) {
    return {
      text: "Here is a closer view of Lagos Central Business District.",
      media: {
        url: "https://images.unsplash.com/photo-1477959858617-67f30bc75b82?auto=format&fit=crop&w=800&q=80",
        caption: "Lagos CBD",
        metadata: "Sentinel-2A • 10m resolution",
      },
    };
  }

  if (msg.includes('urban heat island') || msg.includes('uhi')) {
    return {
      text: "**Urban Heat Islands (UHI)** occur when cities are significantly warmer than surrounding rural areas. Key causes include:\n\n- **Impervious surfaces** (asphalt, concrete) absorbing and re-emitting solar radiation\n- **Reduced vegetation** limiting evapotranspiration cooling\n- **Anthropogenic heat** from vehicles, buildings, and industry\n- **Canyon effects** in dense urban corridors trapping heat\n\nUHIs can increase local temperatures by 1–7°C compared to nearby non-urban areas, increasing energy demand, heat-related health risks, and air pollution. Urban greening, cool roofs, and permeable pavements are key mitigation strategies.\n\n*Note: This is a general explanation. See the Hotspots page for illustrative local data.*",
    };
  }

  if (msg.includes('ndvi') || msg.includes('normalized difference vegetation')) {
    return {
      text: "**NDVI (Normalized Difference Vegetation Index)** measures vegetation density and health using satellite imagery.\n\n**Formula:** NDVI = (NIR − Red) / (NIR + Red)\n\nWhere NIR is near-infrared reflectance and Red is visible red reflectance.\n\n**Interpretation:**\n- **0.8 – 1.0:** Dense, healthy vegetation (tropical rainforest)\n- **0.4 – 0.8:** Moderate vegetation (grasslands, crops)\n- **0.2 – 0.4:** Sparse vegetation\n- **0.0 – 0.2:** Bare soil, urban surfaces\n- **< 0:** Water bodies\n\n**Important:** NDVI is not a direct measure of tree canopy percentage. It reflects surface reflectance patterns and can be affected by atmospheric conditions, sensor calibration, and season.\n\n*The vegetation percentages in this demo are illustrative and do not represent real NDVI measurements.*",
    };
  }

  if (msg.includes('land surface temperature') || msg.includes('lst')) {
    return {
      text: "**Land Surface Temperature (LST)** is the radiative skin temperature of the Earth's surface measured by thermal infrared sensors on satellites like Landsat 8/9 and Sentinel-3.\n\n**How it's measured:**\n1. Satellite thermal sensors detect emitted infrared radiation\n2. Atmospheric corrections are applied to remove atmospheric effects\n3. Surface emissivity is estimated based on land cover type\n4. Temperature is derived from the corrected radiance\n\n**Key distinctions:**\n- LST ≠ air temperature (can differ by 5–20°C in urban areas)\n- LST represents instantaneous surface temperature at the overpass time\n- Cloud cover prevents measurement (cloudy pixels are excluded)\n- Spatial resolution typically 30–100m for common sensors\n\n*The temperature values in this demo are illustrative and do not represent real satellite measurements.*",
    };
  }

  if (msg.includes('vegetation') && (msg.includes('reduce') || msg.includes('cool') || msg.includes('help'))) {
    return {
      text: "**How vegetation reduces urban heat:**\n\n1. **Evapotranspiration:** Trees and plants release water vapor, cooling surrounding air\n2. **Shading:** Canopies block direct solar radiation from reaching pavements\n3. **Albedo:** Vegetation absorbs and reflects radiation without the heat retention of asphalt\n4. **Wind channels:** Strategic tree corridors channel cooling breezes through urban centers\n\n**Estimated cooling effects:**\n- Mature street trees can reduce local surface temperatures by 2–8°C\n- Urban pocket parks can be 1–4°C cooler than adjacent concrete\n\n*General research findings, not site-specific guarantees.*",
    };
  }

  if (msg.includes('central walk') || (context.selectedHotspot && context.selectedHotspot.toLowerCase().includes('central walk'))) {
    return {
      text: "**Central Walk** is classified as a high-priority zone in this dataset based on:\n\n- **Surface temperature:** 36.2°C (illustrative)\n- **Vegetation coverage:** 11% (illustrative)\n- **Priority score:** 91/100\n\nIn this demonstration, zones are prioritized by combining high surface temperature with low vegetation coverage, as areas with both characteristics tend to represent the greatest heat vulnerability and greening opportunity.\n\n**Recommended actions:**\n- Establish continuous shaded green corridors along pedestrian walks\n- Implement cool pavement coatings on parking strips\n- Integrate reflective building envelope guidelines",
    };
  }

  if (context.selectedLocation) {
    return {
      text: `You're inspecting **${context.selectedLocation}**. Based on the monitored data, this sector exhibits elevated thermal radiance and qualifies for urban greening prioritization. Would you like me to summarize recommended interventions or open the candidate dossier?`,
    };
  }

  return DEMO_RESPONSES.default;
}

let messageCounter = 0;

export const chatService = {
  generateId: () => `msg-${Date.now()}-${++messageCounter}`,

  async sendMessage(
    userMessage: string,
    _history: ChatMessage[],
    context: ChatContext
  ): Promise<ChatReply> {
    // Realistic simulation delay
    await new Promise(resolve => setTimeout(resolve, 600 + Math.random() * 400));
    return generateDemoResponse(userMessage, context);
  },
};
