PImage img;
int cols;
int rows;
int[][] grid;
int[][] buffer;

boolean pause = false;
int cellSize = 1;

// Tweak here!! 
// 9, 13, 34, 66, 90, numbers between 40 and 120 work well if stripesB == false
int distProbability = 100; 
// Toggle this!!
boolean stripesB = false; 


void setup() {
  size(600, 600);
  frameRate(30);
  noSmooth();
  background(255);
  
  cols    = int(width/cellSize);
  rows    = int(height/cellSize);
  img     = createImage(cols, rows, RGB);

  grid    = new int[rows][cols];
  buffer  = new int[rows][cols];
  grid    = populate(grid);
}

int[][] populate(int[][] g) {
  int rows = g.length;
  int cols = (rows > 0) ? g[0].length : 0;
  for (int i=0; i < rows; i++) {
    for (int j=0; j < cols; j++) {
      if (stripesB) {
        g[i][j] = (i%distProbability == 0 || j==0) ? 0 : 1; 
      } else {
        g[i][j] = (j%distProbability == 0 || i%(distProbability) == 0) ? 0 : 1; 
      }
    }
  }
  return g;
}

int[][] empty(int[][] g) {
  int rows = g.length;
  int cols = (rows > 0) ? g[0].length : 0;
  for (int i=0; i < rows; i++) {
    for (int j=0; j < cols; j++) {
      g[i][j] = 0;
    }
  }
  return g;
}

void process() {
  int[][] buffer = new int[rows][cols];
  for (int i=0; i < rows; i++) {
    for (int j=0; j < cols; j++) {

      int idxLeft     = (j > 0) ? j - 1 : j;
      int idxRight    = (j < cols-1) ? j + 1 : 0;
      int idxTop      = (i > 0) ? i - 1 : i;
      int idxBottom   = (i < rows-1) ? i + 1 : 0;

      int current     = grid[i][j];
      int left        = grid[i][idxLeft];
      int right       = grid[i][idxRight];
      int top         = grid[idxTop][j];
      int bottom      = grid[idxBottom][j];
      int topLeft     = grid[idxTop][idxLeft];
      int topRight    = grid[idxTop][idxRight];
      int bottomLeft  = grid[idxBottom][idxLeft];
      int bottomRight = grid[idxBottom][idxRight];

      int sum = left + right + top + bottom + topLeft + topRight + bottomLeft + bottomRight;

      // Rules of Life ... slightly modified ;)
      if      ((current == 1) && sum < 6)                                buffer[i][j] = topLeft;
      else if ((current == topLeft))                                     buffer[i][j] = 1;
      else                                                               buffer[i][j] = current; 
    }
  } 
  grid = buffer;
}

void draw() {
  background(255);
  
  int index = 0;
  img.loadPixels();
  for (int i=0; i < rows; i++) {
    for (int j=0; j < cols; j++) {
      int cell = grid[i][j];
      color c = color(255);
      if (cell == 1) {
        if (j > 0 && i > 0) {
          
          //boolean diagonal = grid[i-1][j-1] == 1;
          //boolean horizontal = grid[i-1][j] == 1;
          boolean vertical = grid[i][j-1] == 1;
         
          if (vertical) {
            c = color(0, 0, 255);
          } else {
            c = color(0);  
          }
        } else {
          c = color(0);
        }
      }
      img.pixels[index] = c;
      index++;
    }
  }
  img.updatePixels();
  image(img, 0, 0, width, height);
  
  if (!pause) process();
}

void keyPressed() {
  if(key == ' ') {
    pause = !pause;
  }
  if(key == 'r') {
    grid = populate(grid);
  }
  if(key == 'c') {
    grid = empty(grid);
  }
}

void mouseDragged() {
  int indexX = constrain(floor(mouseX / cellSize), 0, cols-1);
  int indexY = constrain(floor(mouseY / cellSize), 0, rows-1);
  int cell   = grid[indexY][indexX];

  cell = (cell == 0) ? 1 : 0;
  grid[indexY][indexX] = cell;
}