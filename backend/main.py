import modal

app = modal.App("sam3-api")

# Define the container image with all dependencies
image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git")
    .pip_install(
        "torch==2.7.0",
        "torchvision",
        "torchaudio",
        "huggingface_hub",
        "Pillow",
        "fastapi[standard]",
        extra_index_url="https://download.pytorch.org/whl/cu126"
    )
    .run_commands(
        "git clone https://github.com/facebookresearch/sam3.git /sam3",
        "cd /sam3 && pip install -e ."
    )
)

@app.cls(image=image, gpu="A10G", secrets=[modal.Secret.from_name("huggingface")])
class SAM3:
    @modal.enter()
    def load_model(self):
        import sys
        sys.path.insert(0, "/sam3")
        from sam3.model_builder import build_sam3_image_model
        from sam3.model.sam3_image_processor import Sam3Processor
        
        print("Loading SAM3...")
        self.model = build_sam3_image_model()
        self.processor = Sam3Processor(self.model)
        print("SAM3 loaded!")

    @modal.method()
    def segment(self, image_base64: str, prompt: str):
        import base64
        import io
        from PIL import Image
        
        image_bytes = base64.b64decode(image_base64)
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        
        state = self.processor.set_image(image)
        output = self.processor.set_text_prompt(state=state, prompt=prompt)
        
        masks = output["masks"]
        boxes = output["boxes"].tolist() if len(output["boxes"]) > 0 else []
        scores = output["scores"].tolist() if len(output["scores"]) > 0 else []
        
        masks_base64 = []
        for mask in masks:
            mask_np = (mask.cpu().numpy() * 255).astype("uint8")
            mask_img = Image.fromarray(mask_np)
            buffer = io.BytesIO()
            mask_img.save(buffer, format="PNG")
            masks_base64.append(base64.b64encode(buffer.getvalue()).decode())
        
        return {"masks_base64": masks_base64, "boxes": boxes, "scores": scores}

@app.function(image=image)
@modal.web_endpoint(method="POST")
def segment_endpoint(request: dict):
    sam3 = SAM3()
    return sam3.segment.remote(request["image_base64"], request["prompt"])

@app.function(image=image)
@modal.web_endpoint(method="GET")
def health():
    return {"status": "ok"}