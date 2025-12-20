import modal

app = modal.App("sam3-api")

sam3_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git")
    .pip_install(
        "torch==2.8.0",
        "torchvision",
        "git+https://github.com/facebookresearch/sam3.git",
        "einops",
        "decord", 
        "opencv-python",
        "pycocotools",
        "fastapi",
        "pillow",
        "psutil",  # Added missing dependency
    )
    .run_commands("git clone --depth 1 https://github.com/facebookresearch/sam3.git /sam3_repo")
)

@app.cls(
    image=sam3_image,
    gpu="A10G",
    secrets=[modal.Secret.from_name("huggingface")],
    scaledown_window=300,  # Updated from container_idle_timeout
)
class SAM3:
    @modal.enter()
    def load_model(self):
        import os
        from huggingface_hub import login
        login(token=os.environ["HF_TOKEN"])
        
        from sam3 import build_sam3_image_model
        from sam3.model.sam3_image_processor import Sam3Processor
        import torch
        
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True
        
        bpe_path = "/sam3_repo/sam3/assets/bpe_simple_vocab_16e6.txt.gz"
        self.model = build_sam3_image_model(bpe_path=bpe_path)
        self.Sam3Processor = Sam3Processor
        print("Model loaded!")

    @modal.fastapi_endpoint(method="POST")  # Updated from web_endpoint
    def segment(self, request: dict):
        import base64
        import io
        from PIL import Image
        
        image_b64 = request.get("image_base64")
        image_bytes = base64.b64decode(image_b64)
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        
        text_prompt = request.get("prompt", "object")
        confidence = request.get("confidence", 0.5)
        
        processor = self.Sam3Processor(self.model, confidence_threshold=confidence)
        inference_state = processor.set_image(image)
        inference_state = processor.set_text_prompt(state=inference_state, prompt=text_prompt)
        
        results = []
        if "pred_boxes" in inference_state and inference_state["pred_boxes"] is not None:
            boxes = inference_state["pred_boxes"].cpu().numpy().tolist()
            scores = inference_state["pred_scores"].cpu().numpy().tolist() if "pred_scores" in inference_state else []
            
            for i, box in enumerate(boxes):
                results.append({
                    "box": box,
                    "score": scores[i] if i < len(scores) else None
                })
        
        return {"results": results, "count": len(results)}

    @modal.fastapi_endpoint(method="GET")  # Updated from web_endpoint
    def health(self):
        return {"status": "healthy", "model": "SAM3"}
