"""
Groq Vision Service for Screenshot Analysis
Handles screenshot analysis using Groq's vision model (Llama Scout)
"""

import httpx
import base64
import logging
from typing import Dict
from app.core.config import settings

logger = logging.getLogger(__name__)

class GroqVisionService:
    """Service for analyzing screenshots using Groq vision model"""
    
    def __init__(self):
        self.api_key = settings.groq_api_key
        self.base_url = settings.groq_api_base_url
        self.model = settings.vision_model
        
        if not self.api_key:
            logger.warning("GROQ_API_KEY not configured - vision analysis will be disabled")
    
    async def analyze_screenshot(self, image_data: bytes) -> Dict:
        """
        Analyze screenshot using Groq vision model
        
        Args:
            image_data: PNG image data as bytes
            
        Returns:
            Dict with success status and analysis or error
        """
        if not self.api_key:
            return {
                'success': False,
                'error': 'Groq API key not configured'
            }
        
        try:
            # Convert image to base64
            image_base64 = base64.b64encode(image_data).decode('utf-8')
            
            # Prepare the API request for vision model
            headers = {
                'Authorization': f'Bearer {self.api_key}',
                'Content-Type': 'application/json'
            }
            
            payload = {
                "model": self.model,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": "Describe what is being presented in this screenshot"
                            },
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/png;base64,{image_base64}"
                                }
                            }
                        ]
                    }
                ],
                "temperature": 0.1,
                "max_tokens": 500
            }
            
            logger.info(f"🔍 Analyzing screenshot with {self.model} ({len(image_data)} bytes)")
            
            # Make API call to Groq
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers=headers,
                    json=payload
                )
            
            # Handle response
            if response.status_code == 200:
                result = response.json()
                analysis = result['choices'][0]['message']['content']
                
                logger.info(f"✅ Vision analysis successful ({len(analysis)} chars)")
                
                return {
                    'success': True,
                    'analysis': analysis,
                    'model_used': self.model
                }
            else:
                error_msg = f"Groq Vision API Error: {response.status_code}"
                logger.error(f"❌ {error_msg}: {response.text}")
                
                return {
                    'success': False,
                    'error': error_msg,
                    'details': response.text
                }
                
        except httpx.TimeoutException:
            error_msg = "Groq Vision API timeout"
            logger.error(f"❌ {error_msg}")
            return {
                'success': False,
                'error': error_msg
            }
            
        except Exception as e:
            error_msg = f"Vision analysis failed: {str(e)}"
            logger.error(f"❌ {error_msg}")
            return {
                'success': False,
                'error': error_msg
            }


# Global service instance
groq_vision_service = GroqVisionService()
