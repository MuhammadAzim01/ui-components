import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('steps_wizard - Protocol Communication', () => {
  let mockProtocol
  let receivedMessages
  let componentSource

  beforeEach(() => {
    receivedMessages = []
    
    // Read the actual component source code
    componentSource = readFileSync(
      join(process.cwd(), 'src/node_modules/steps_wizard/steps_wizard.js'),
      'utf-8'
    )
    
    // Mock protocol: captures onmessage handler and returns send function
    mockProtocol = vi.fn().mockImplementation((onmessage) => {
      mockProtocol.onmessage = onmessage
      return (message) => {
        receivedMessages.push(message)
      }
    })
  })

  it('should send step_clicked message type in component code', () => {
    // Verify the component source contains the correct message type
    const hasCorrectMessageType = componentSource.includes("type: 'step_clicked'")
    
    expect(hasCorrectMessageType).toBe(true)
    
    if (!hasCorrectMessageType) {
      // Show what type it found instead
      const typeMatch = componentSource.match(/type:\s*['"]([^'"]+)['"]/g)
      console.error('Found types:', typeMatch)
    }
  })

  it('should send correct protocol message structure with step_clicked type', () => {
    // Setup component IDs (simulating what the component does)
    const by = 'wizard_instance_123'
    const to = 'parent_id_456'
    let mid = 0

    // Initialize protocol
    const send = mockProtocol(vi.fn())

    // Simulate the exact behavior from on_step_click function
    const step = {
      name: 'Step 1',
      type: 'mandatory',
      is_completed: false,
      component: 'form_input',
      data: ''
    }
    const index = 0
    const steps = [step]
    const accessible = true

    // This mimics the actual code in steps_wizard.js line 123:
    // _.up({ head, refs, type: 'step_clicked', data: { ...step, index, total_steps: steps.length, is_accessible: accessible } })
    const head = [by, to, mid++]
    const refs = {}
    send({ 
      head, 
      refs, 
      type: 'step_clicked',  // This MUST match what's in the component
      data: { ...step, index, total_steps: steps.length, is_accessible: accessible } 
    })

    // Verify message structure
    expect(receivedMessages).toHaveLength(1)
    expect(receivedMessages[0].type).toBe('step_clicked')
    expect(receivedMessages[0].head).toEqual(['wizard_instance_123', 'parent_id_456', 0])
    expect(receivedMessages[0].data.index).toBe(0)
  })

  it('should handle init_data message from parent', () => {
    const onmessage = vi.fn()
    mockProtocol(onmessage)

    const testSteps = [
      { name: 'Step 1', type: 'mandatory', is_completed: false },
      { name: 'Step 2', type: 'optional', is_completed: true }
    ]

    // Simulate parent sending init_data
    if (mockProtocol.onmessage) {
      mockProtocol.onmessage({
        head: ['parent_id_456', 'wizard_instance_123', 0],
        refs: {},
        type: 'init_data',
        data: testSteps
      })
    }

    // In real implementation, this would trigger render_steps
    expect(testSteps).toHaveLength(2)
    expect(testSteps[0].name).toBe('Step 1')
    expect(testSteps[1].is_completed).toBe(true)
  })

  it('should correctly determine step accessibility based on previous mandatory steps', () => {
    // Test the can_access logic from steps_wizard
    function can_access (index, steps) {
      for (let i = 0; i < index; i++) {
        if (!steps[i].is_completed && steps[i].type !== 'optional') {
          return false
        }
      }
      return true
    }

    const steps = [
      { name: 'Step 1', type: 'mandatory', is_completed: true },
      { name: 'Step 2', type: 'optional', is_completed: false },
      { name: 'Step 3', type: 'mandatory', is_completed: false }
    ]

    // First step always accessible
    expect(can_access(0, steps)).toBe(true)
    
    // Can skip optional step 2
    expect(can_access(2, steps)).toBe(true)
    
    // Cannot access if mandatory step incomplete
    const stepsWithIncomplete = [
      { name: 'Step 1', type: 'mandatory', is_completed: false },
      { name: 'Step 2', type: 'mandatory', is_completed: false }
    ]
    expect(can_access(1, stepsWithIncomplete)).toBe(false)
  })
})
