import fs from 'fs';
import path from 'path';

const customerStorePath = path.join(process.cwd(), 'src/components/CustomerStore.tsx');
let content = fs.readFileSync(customerStorePath, 'utf-8');

// We want to replace theme-related hardcoded colors while preserving renderDietMark veg/non-veg indicators.
// Let's split content or protect renderDietMark.
const dietMarkRegex = /const renderDietMark =[\s\S]*?};/;
const dietMarkMatch = content.match(dietMarkRegex);
const dietMarkCode = dietMarkMatch ? dietMarkMatch[0] : '';

// Replace general UI occurrences of #E23744, #FFF5F3, #2A1618, etc.
content = content.replace(/bg-\[#E23744\]/g, 'bg-primary');
content = content.replace(/text-\[#E23744\]/g, 'text-primary');
content = content.replace(/border-\[#E23744\]/g, 'border-primary');
content = content.replace(/fill-\[#E23744\]/g, 'fill-primary');
content = content.replace(/hover:bg-\[#E23744\]/g, 'hover:bg-primary');
content = content.replace(/accent-\[#E23744\]/g, 'accent-primary');
content = content.replace(/focus:border-\[#E23744\]/g, 'focus:border-primary');

content = content.replace(/bg-\[#FFF5F3\]/g, 'bg-soft-tint');
content = content.replace(/hover:bg-\[#FFF5F3\]/g, 'hover:bg-soft-tint');

content = content.replace(/dark:bg-\[#2A1618\]/g, '');
content = content.replace(/dark:bg-\[#E23744\]\/20/g, '');
content = content.replace(/dark:bg-\[#E23744\]\/15/g, '');
content = content.replace(/dark:border-\[#2E2E2E\]/g, '');
content = content.replace(/dark:bg-\[#1C1C1C\]/g, '');

content = content.replace(/hover:bg-\[#c82d39\]/g, 'hover:opacity-90');

// Restore renderDietMark to use fixed #1BA672 and #E23744 as required by instruction 3
if (dietMarkMatch) {
  content = content.replace(dietMarkRegex, `
  const renderDietMark = (isVeg: boolean) => (
    <span
      className={\`inline-flex items-center justify-center w-4 h-4 rounded-[4px] border-2 shrink-0 \${
        isVeg
          ? 'border-[#1BA672] bg-white dark:bg-[#1C1C1C]'
          : 'border-[#E23744] bg-white dark:bg-[#1C1C1C]'
      }\`}
      aria-label={isVeg ? 'Vegetarian (FSSAI)' : 'Non-Vegetarian (FSSAI)'}
      title={isVeg ? 'Pure Veg' : 'Non-Veg'}
    >
      <span
        className={\`w-2 h-2 rounded-full \${isVeg ? 'bg-[#1BA672]' : 'bg-[#E23744]'}\`}
      />
    </span>
  );
  `);
}

fs.writeFileSync(customerStorePath, content, 'utf-8');
console.log('CustomerStore.tsx theme refactored successfully.');
