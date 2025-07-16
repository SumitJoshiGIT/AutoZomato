# Prompt Context Integration

## Overview
The AutoZomato extension now properly utilizes prompt context from `settings.json` to customize AI behavior during review analysis and response generation.

## Configuration

### Settings.json Structure
```json
{
  "promptContext": {
    "systemPrompt": "You are a helpful restaurant manager writing polite and professional replies to customer reviews. Keep responses short, grateful, and address any specific concerns mentioned.",
    "replyPrompt": "Write a polite and professional reply to this restaurant review",
    "maxTokens": 150,
    "temperature": 0.7
  }
}
```

### Prompt Context Parameters

#### Core Parameters
- **systemPrompt**: Custom system message that sets the AI's role and behavior
- **replyPrompt**: Base prompt for reply generation (currently used for analysis)
- **maxTokens**: Maximum number of tokens to generate (maps to `num_predict` in Ollama)
- **temperature**: Controls randomness in responses (0.0 = deterministic, 1.0 = very random)

#### Extended Parameters (can be added)
- **customInstructions**: Additional context for specific business needs
- **tone**: Desired tone of responses (formal, friendly, etc.)
- **language**: Language preference for responses

## Implementation Flow

### 1. Background Script Initialization
- Loads prompt context from `settings.json` during startup
- Stores prompt context in `this.promptContext`
- Passes prompt context to content scripts via `config` object

### 2. Content Script Usage
- Receives prompt context through `window.autoZomatoConfig.promptContext`
- Integrates system prompt into AI analysis prompts
- Uses temperature and maxTokens for Ollama API calls
- Supports additional context parameters for enhanced customization

### 3. AI Analysis Enhancement
- **System Prompt**: Prepended to analysis prompts to set AI behavior
- **Temperature**: Controls response variability for better consistency
- **Max Tokens**: Limits response length to prevent overly long outputs
- **Custom Instructions**: Allows business-specific guidance

## Code Changes

### Files Modified
- `src/background/background.js`: Added `loadPromptContext()` method
- `src/content/content.js`: Enhanced AI prompt generation with context parameters
- `settings.json`: Contains prompt context configuration

### Key Functions
- `loadPromptContext()`: Loads settings and stores prompt context
- `replyToReviews()`: Uses prompt context in AI analysis
- Ollama API calls: Include temperature and maxTokens parameters

## Usage Examples

### Basic System Prompt
```json
{
  "systemPrompt": "You are a professional restaurant manager. Be polite and helpful."
}
```

### Advanced Configuration
```json
{
  "systemPrompt": "You are a restaurant manager for a fine dining establishment. Maintain elegance and professionalism.",
  "temperature": 0.5,
  "maxTokens": 200,
  "customInstructions": "Always mention our commitment to quality ingredients",
  "tone": "formal",
  "language": "english"
}
```

## Benefits

1. **Customizable AI Behavior**: Tailor responses to match brand voice
2. **Consistent Output**: Control randomness with temperature settings
3. **Flexible Configuration**: Easy to modify without code changes
4. **Extensible**: Support for additional context parameters
5. **Professional Responses**: System prompts ensure appropriate tone

## Future Enhancements

1. **UI Integration**: Add prompt context fields to popup interface
2. **Template System**: Combine prompt context with response templates
3. **Multi-language Support**: Enhanced language-specific customization
4. **A/B Testing**: Different prompt contexts for different scenarios
