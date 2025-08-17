/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: ['webexapis.com'],
  },
  // Environment variables that should be available to the client
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL,
  },
}

module.exports = nextConfig
