
import type { NextConfig } from "next";



const nextConfig: NextConfig = {

  // Move it out of experimental

  allowedDevOrigins: ['trucker-ai.com', 'www.trucker-ai.com'],

  logging: {

    fetches: {

      fullUrl: true,

    },

  },

};



export default nextConfig;

