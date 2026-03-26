# Civil War GIS Mapper: Mechanicsville Edition
### "What happened in my front yard?"

An interactive, high-precision GIS application built to map the tactical movements and historical fortifications of the **Battle of Mechanicsville (Beaver Dam Creek)**. This project leverages modern web technologies to visualize 1862 troop positions over contemporary Virginia landscapes.

---

## 🗺️ Project Overview
This tool is part of a broader effort to document the **Seven Days Battles**, specifically focusing on the area around Mechanicsville, VA. By layering historical military maps over modern Mapbox vector tiles, we can identify exactly where earthworks, artillery batteries, and skirmish lines sat in relation to today's property lines.

## 🛠️ Technical Stack
* **Framework:** [Next.js](https://nextjs.org/) (App Router)
* **Mapping Engine:** [Mapbox GL JS](https://docs.mapbox.com/mapbox-gl-js/api/)
* **Spatial Analysis:** [@turf/turf](https://turfjs.org/) for calculating distances, headings, and area-of-effect for artillery range rings.
* **Styling:** Tailwind CSS (v4)

## 📐 Mathematical Approach
Utilizing the **OGI Framework** principles, this mapper treats historical data points as adaptive coordinates. 
* **Coordinate Transformation:** Translating 19th-century hand-drawn surveyor units into decimal degrees.
* **Geodesic Calculations:** Using Turf.js to ensure that line-of-sight and battery ranges account for the curvature of the Earth (WGS84 ellipsoid).

## 🚀 Getting Started

1.  **Clone the repo:**
    ```bash
    git clone [https://github.com/singleton2787/civil-war-mapper.git](https://github.com/singleton2787/civil-war-mapper.git)
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    ```
3.  **Environment Variables:**
    Create a `.env.local` file and add your Mapbox token:
    ```text
    NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=your_token_here
    ```
4.  **Run Development Server:**
    ```bash
    npm run dev
    ```

## 📜 Historical Context: Beaver Dam Creek
On June 26, 1862, this ground saw the first major engagement of the Seven Days Battles. This mapper focuses on the Confederate assault across the creek against the Union's formidable defensive line. 

> *"The math of the battlefield is written in the dirt of the front yard."*

---
**Author:** Michael Singleton  
**Publisher:** Beaver Press / O'Really?  
**Framework:** OGI (Open Graphical Intelligence)
