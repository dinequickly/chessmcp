import argparse
import sys
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

def main():
    parser = argparse.ArgumentParser(description='Generate Chess Commentary')
    parser.add_argument('--fen', required=True, help='FEN position')
    parser.add_argument('--move', required=True, help='Move in SAN format')
    parser.add_argument('--side', required=True, help='Side (White/Black)')
    parser.add_argument('--tag', required=True, help='Move Tag (Best, Good, Mistake, etc.)')
    parser.add_argument('--best_alt', required=True, help='Best alternative move')
    parser.add_argument('--cp', required=True, help='Centipawn evaluation change (e.g. "27->21 (Δ=6)")')
    
    args = parser.parse_args()

    model_id = "NAKSTStudio/chess-gemma-commentary"
    
    try:
        # Determine device
        device = "cpu"
        if torch.cuda.is_available():
            device = "cuda"
        elif torch.backends.mps.is_available():
            device = "mps"
            
        print(f"Loading model on {device}...", file=sys.stderr)

        tokenizer = AutoTokenizer.from_pretrained(model_id)
        model = AutoModelForCausalLM.from_pretrained(
            model_id,
            torch_dtype=torch.float16 if device != "cpu" else torch.float32,
        ).to(device)

        messages = [
            {
                'role': 'system',
                'content': 'Generate professional chess commentary in the specified language. For Type=standard use 30–40 words. For Type=explanation, explain the best move briefly (≤50 words). Return exactly: Commentary, Predicted ELO, Verified Classification.'
            },
            {
                'role': 'user',
                'content': f'''LanguageL: English
LangCode: en
Type: standard
FEN: {args.fen}
MoveSAN: {args.move}
Side: {args.side}
Actor: bot
Tag: {args.tag}
BestAlt: {args.best_alt}
CP: {args.cp}'''
            }
        ]

        inputs = tokenizer.apply_chat_template(messages, return_tensors="pt", add_generation_prompt=True).to(device)
        
        outputs = model.generate(
            inputs, 
            max_new_tokens=256, 
            temperature=0.7,
            do_sample=True
        )
        
        response = tokenizer.decode(outputs[0], skip_special_tokens=True)
        
        # Extract the assistant's response (everything after the prompt)
        # The tokenizer.decode might include the full conversation, so we split/clean if needed.
        # But apply_chat_template typically handles the prompt structure. 
        # We'll just print the last part which is the model output.
        # Actually, decode(outputs[0]) returns the whole string. We need to find where the generation started.
        
        # Simple heuristic: Split by "model\n" if it puts that there, or just print the raw output for now.
        # Better: decode only the new tokens.
        
        generated_text = tokenizer.decode(outputs[0][inputs.shape[1]:], skip_special_tokens=True)
        print(generated_text)

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
