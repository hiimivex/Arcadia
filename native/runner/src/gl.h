// Chargeur OpenGL minimal pour le runner (les cœurs chargent le leur via get_proc_address).
// Préfixe xgl : évite d'intercepter les symboles gl* de libGL utilisés par les cœurs sous Linux.
#pragma once
#include <SDL3/SDL.h>
#include <cstdint>

#ifndef APIENTRY
#  ifdef _WIN32
#    define APIENTRY __stdcall
#  else
#    define APIENTRY
#  endif
#endif

typedef unsigned int GLenum; typedef unsigned int GLuint; typedef int GLint; typedef int GLsizei;
typedef unsigned int GLbitfield; typedef float GLfloat; typedef unsigned char GLboolean; typedef void GLvoid;

#define GL_TEXTURE_2D 0x0DE1
#define GL_TEXTURE_MIN_FILTER 0x2801
#define GL_TEXTURE_MAG_FILTER 0x2800
#define GL_TEXTURE_WRAP_S 0x2802
#define GL_TEXTURE_WRAP_T 0x2803
#define GL_CLAMP_TO_EDGE 0x812F
#define GL_LINEAR 0x2601
#define GL_NEAREST 0x2600
#define GL_RGBA 0x1908
#define GL_RGB 0x1907
#define GL_BGRA 0x80E1
#define GL_RGBA8 0x8058
#define GL_UNSIGNED_BYTE 0x1401
#define GL_UNSIGNED_SHORT_5_6_5 0x8363
#define GL_UNSIGNED_SHORT_1_5_5_5_REV 0x8366
#define GL_UNSIGNED_INT_8_8_8_8_REV 0x8367
#define GL_UNPACK_ROW_LENGTH 0x0CF2
#define GL_UNPACK_ALIGNMENT 0x0CF5
#define GL_PACK_ALIGNMENT 0x0D05
#define GL_PACK_ROW_LENGTH 0x0D02
#define GL_FRAMEBUFFER 0x8D40
#define GL_READ_FRAMEBUFFER 0x8CA8
#define GL_DRAW_FRAMEBUFFER 0x8CA9
#define GL_RENDERBUFFER 0x8D41
#define GL_COLOR_ATTACHMENT0 0x8CE0
#define GL_DEPTH_STENCIL_ATTACHMENT 0x821A
#define GL_DEPTH24_STENCIL8 0x88F0
#define GL_DEPTH_COMPONENT24 0x81A6
#define GL_DEPTH_ATTACHMENT 0x8D00
#define GL_FRAMEBUFFER_COMPLETE 0x8CD5
#define GL_COLOR_BUFFER_BIT 0x00004000
#define GL_SCISSOR_TEST 0x0C11
#define GL_FRAMEBUFFER_SRGB 0x8DB9
#define GL_PIXEL_PACK_BUFFER 0x88EB
#define GL_PIXEL_UNPACK_BUFFER 0x88EC

#define GLFUNCS(X) \
  X(void, GenFramebuffers, (GLsizei, GLuint*)) \
  X(void, DeleteFramebuffers, (GLsizei, const GLuint*)) \
  X(void, BindFramebuffer, (GLenum, GLuint)) \
  X(void, FramebufferTexture2D, (GLenum, GLenum, GLenum, GLuint, GLint)) \
  X(void, GenRenderbuffers, (GLsizei, GLuint*)) \
  X(void, DeleteRenderbuffers, (GLsizei, const GLuint*)) \
  X(void, BindRenderbuffer, (GLenum, GLuint)) \
  X(void, RenderbufferStorage, (GLenum, GLenum, GLsizei, GLsizei)) \
  X(void, FramebufferRenderbuffer, (GLenum, GLenum, GLenum, GLuint)) \
  X(GLenum, CheckFramebufferStatus, (GLenum)) \
  X(void, BlitFramebuffer, (GLint, GLint, GLint, GLint, GLint, GLint, GLint, GLint, GLbitfield, GLenum)) \
  X(void, GenTextures, (GLsizei, GLuint*)) \
  X(void, DeleteTextures, (GLsizei, const GLuint*)) \
  X(void, BindTexture, (GLenum, GLuint)) \
  X(void, TexImage2D, (GLenum, GLint, GLint, GLsizei, GLsizei, GLint, GLenum, GLenum, const void*)) \
  X(void, TexSubImage2D, (GLenum, GLint, GLint, GLint, GLsizei, GLsizei, GLenum, GLenum, const void*)) \
  X(void, TexParameteri, (GLenum, GLenum, GLint)) \
  X(void, PixelStorei, (GLenum, GLint)) \
  X(void, ReadPixels, (GLint, GLint, GLsizei, GLsizei, GLenum, GLenum, void*)) \
  X(void, Viewport, (GLint, GLint, GLsizei, GLsizei)) \
  X(void, ClearColor, (GLfloat, GLfloat, GLfloat, GLfloat)) \
  X(void, Clear, (GLbitfield)) \
  X(void, Disable, (GLenum)) \
  X(void, Enable, (GLenum)) \
  X(void, ColorMask, (GLboolean, GLboolean, GLboolean, GLboolean)) \
  X(void, BindBuffer, (GLenum, GLuint)) \
  X(void, UseProgram, (GLuint)) \
  X(void, Finish, (void))

#define GLDECL(ret, name, args) typedef ret (APIENTRY *PFN_xgl##name) args; extern PFN_xgl##name xgl##name;
GLFUNCS(GLDECL)
#undef GLDECL

bool glLoad();
